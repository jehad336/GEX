"""Application settings. All secrets are read from the environment - server side only."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", REPO_ROOT / ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # provider selection
    data_provider: str = "demo"
    fallback_provider: str = "tradier"

    # credentials
    massive_api_key: str = ""
    massive_base_url: str = "https://api.massive.com"
    massive_ws_url: str = "wss://socket.massive.com"
    # Never inferred: the vendor does not flag delay, and guessing
    # upward would label 15-minute data as LIVE.
    massive_realtime: bool = False

    tradier_api_key: str = ""
    tradier_base_url: str = "https://api.tradier.com/v1"

    orats_api_key: str = ""
    orats_base_url: str = "https://api.orats.io/datav2"

    # infra
    database_url: str = ""
    redis_url: str = ""

    # behaviour
    demo_mode: bool = True
    log_level: str = "INFO"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    cache_ttl_chain: int = 45
    cache_ttl_underlying: int = 5
    cache_ttl_expirations: int = 900
    cache_ttl_bars: int = 60

    # quant defaults
    gex_sign_convention: str = "calls_positive_puts_negative"
    contract_multiplier_default: int = 100
    risk_free_rate: float = 0.043
    dividend_yield: float = 0.0

    http_timeout: float = 12.0
    max_retries: int = 3

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def has_credentials(self, provider: str) -> bool:
        return bool(
            {
                "massive": self.massive_api_key,
                "tradier": self.tradier_api_key,
                "orats": self.orats_api_key,
                "demo": "always",
            }.get(provider, "")
        )

    def effective_provider(self) -> str:
        """Resolve the provider actually usable at boot."""
        if self.demo_mode:
            return "demo"
        if self.has_credentials(self.data_provider):
            return self.data_provider
        if self.has_credentials(self.fallback_provider):
            return self.fallback_provider
        return "demo"


@lru_cache
def get_settings() -> Settings:
    return Settings()
