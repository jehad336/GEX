"""Two-tier cache: Redis when configured, in-process TTL dict otherwise.

Redis being unavailable must never take the dashboard down, so every Redis call
degrades to the local tier rather than raising.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import pickle
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

log = logging.getLogger("gex.cache")

T = TypeVar("T")


class MemoryCache:
    def __init__(self, max_entries: int = 512):
        self._data: dict[str, tuple[float, Any]] = {}
        self.max_entries = max_entries

    def get(self, key: str) -> Any | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        expires, value = entry
        if time.monotonic() > expires:
            self._data.pop(key, None)
            return None
        return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        if len(self._data) >= self.max_entries:
            # Evict whatever expires soonest - cheap and good enough at this size.
            oldest = min(self._data, key=lambda k: self._data[k][0])
            self._data.pop(oldest, None)
        self._data[key] = (time.monotonic() + ttl, value)

    def invalidate(self, prefix: str = "") -> int:
        keys = [k for k in self._data if k.startswith(prefix)]
        for k in keys:
            self._data.pop(k, None)
        return len(keys)

    def age_of(self, key: str, ttl: float) -> float | None:
        entry = self._data.get(key)
        if entry is None:
            return None
        return max(0.0, ttl - (entry[0] - time.monotonic()))


class Cache:
    def __init__(self, redis_url: str = ""):
        self.memory = MemoryCache()
        self.redis_url = redis_url
        self._redis = None
        self._locks: dict[str, asyncio.Lock] = {}

    async def _get_redis(self):
        if not self.redis_url:
            return None
        if self._redis is None:
            try:
                import redis.asyncio as aioredis

                self._redis = aioredis.from_url(self.redis_url, socket_timeout=1.0)
                await self._redis.ping()
                log.info("redis cache connected")
            except Exception as exc:
                log.warning("redis unavailable, using in-process cache only: %s", exc)
                self.redis_url = ""
                self._redis = None
        return self._redis

    async def get(self, key: str) -> Any | None:
        local = self.memory.get(key)
        if local is not None:
            return local
        r = await self._get_redis()
        if r is None:
            return None
        try:
            raw = await r.get(key)
            return pickle.loads(raw) if raw else None
        except Exception as exc:
            log.warning("redis get failed for %s: %s", key, exc)
            return None

    async def set(self, key: str, value: Any, ttl: float) -> None:
        self.memory.set(key, value, ttl)
        r = await self._get_redis()
        if r is None:
            return
        try:
            await r.setex(key, int(max(ttl, 1)), pickle.dumps(value))
        except Exception as exc:
            log.warning("redis set failed for %s: %s", key, exc)

    async def get_or_set(
        self, key: str, ttl: float, factory: Callable[[], Awaitable[T]]
    ) -> T:
        """Single-flight: concurrent misses on one key produce one upstream call."""
        cached = await self.get(key)
        if cached is not None:
            return cached

        lock = self._locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = await self.get(key)
            if cached is not None:
                return cached
            value = await factory()
            if value is not None:
                await self.set(key, value, ttl)
            return value

    async def invalidate(self, prefix: str) -> int:
        n = self.memory.invalidate(prefix)
        r = await self._get_redis()
        if r is not None:
            try:
                async for k in r.scan_iter(f"{prefix}*"):
                    await r.delete(k)
            except Exception as exc:
                log.warning("redis invalidate failed: %s", exc)
        return n

    async def aclose(self) -> None:
        if self._redis is not None:
            with contextlib.suppress(Exception):
                await self._redis.aclose()
            self._redis = None


_cache: Cache | None = None


def get_cache() -> Cache:
    global _cache
    if _cache is None:
        from app.core.config import get_settings

        _cache = Cache(get_settings().redis_url)
    return _cache
