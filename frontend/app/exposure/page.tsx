import { Suspense } from 'react';

import { ExposureLadderScreen } from '@/components/exposure/ExposureLadderScreen';
import { LoadingBlock } from '@/components/ui';

export default function ExposurePage() {
  return (
    <Suspense fallback={<main className="p-6"><LoadingBlock rows={10} label="Loading Exposure Ladder" /></main>}>
      <ExposureLadderScreen />
    </Suspense>
  );
}
