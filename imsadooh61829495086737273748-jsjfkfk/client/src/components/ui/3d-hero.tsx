import { Suspense, lazy } from 'react';
import { useWebGLSupport } from '@/lib/animation-utils';

const Scene3D = lazy(() => import('./3d-scene'));

function FallbackIllustration() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-64 h-80">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-emerald-500/20 rounded-2xl backdrop-blur-sm border border-white/10">
          <div className="absolute top-8 left-8 right-8 space-y-3">
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur p-3 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-primary/50" />
              <div className="flex-1 space-y-1">
                <div className="h-2 bg-white/30 rounded w-3/4" />
                <div className="h-2 bg-white/20 rounded w-1/2" />
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur p-3 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-emerald-500/50" />
              <div className="flex-1 space-y-1">
                <div className="h-2 bg-white/30 rounded w-2/3" />
                <div className="h-2 bg-white/20 rounded w-1/3" />
              </div>
            </div>
            <div className="flex items-center gap-2 bg-white/10 backdrop-blur p-3 rounded-lg">
              <div className="w-8 h-8 rounded-full bg-blue-500/50" />
              <div className="flex-1 space-y-1">
                <div className="h-2 bg-white/30 rounded w-4/5" />
                <div className="h-2 bg-white/20 rounded w-2/5" />
              </div>
            </div>
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex gap-2 justify-center">
            <div className="w-8 h-1 bg-primary rounded-full" />
            <div className="w-1 h-1 bg-white/30 rounded-full" />
            <div className="w-1 h-1 bg-white/30 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

export default function Hero3D() {
  // Temporarily using fallback illustration for stability
  return <FallbackIllustration />;
}
