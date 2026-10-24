import './PageSkeleton.css';
import type { QueueLayout } from '../utils/playback-queue';

export type SkeletonKind = 'home' | 'landing' | 'setup' | 'library' | 'watch' | 'detail' | 'settings' | 'shorts';

function Lines({ title = false }: { title?: boolean }) {
  return <div className="loading-copy"><div className={'skeleton loading-line ' + (title ? 'loading-title' : '')} /><div className="skeleton loading-line" /><div className="skeleton loading-line loading-line-short" /></div>;
}

function Shelves() {
  return <div className="loading-shelves">{[0, 1].map(row => <div className="loading-shelf" key={row}>
    <div className="skeleton loading-label" /><div className="loading-rail">{[0, 1, 2, 3, 4, 5].map(card => <div key={card}><div className="skeleton loading-thumbnail" /><div className="skeleton loading-caption" /></div>)}</div>
  </div>)}</div>;
}

export function PageSkeleton({ kind, queueLayout }: { kind: SkeletonKind; queueLayout?: QueueLayout }) {
  const marketing = kind === 'landing' || kind === 'setup';
  return <div className={'page-skeleton loading-' + kind} role="status" aria-label="Loading page" aria-busy="true">
    <div aria-hidden="true">
      {marketing ? <div className="loading-marketing-header"><div className="loading-brand"><img src="/virelo-icon-180.png?v=transparent-1" alt="" width="40" height="40" /><span>Virelo</span></div><div className="skeleton loading-action" /></div> : null}
      {kind === 'home' || kind === 'landing' ? <>
        <div className="loading-feature"><div className="loading-feature-copy"><Lines title /><div className="loading-actions"><div className="skeleton loading-action" /><div className="skeleton loading-action" /></div></div></div>
        {kind === 'landing' ? <div className="loading-landing-preview"><div className="skeleton loading-label" /><div className="skeleton loading-preview-image" /></div> : <Shelves />}
      </> : kind === 'watch' ? <div className="loading-watch-layout" data-queue-layout={queueLayout}><div className="loading-video"><div className="loading-video-controls"><div className="skeleton loading-progress" /><div className="skeleton loading-caption" /></div></div><Lines title />{queueLayout === 'vertical' ? <div className="loading-queue"><div className="skeleton loading-label"/>{[0,1,2,3,4,5].map(index => <div className="loading-queue-item" key={index}><div className="skeleton loading-thumbnail"/><div className="skeleton loading-caption"/></div>)}</div> : <Shelves />}</div>
      : kind === 'detail' ? <div className="loading-detail-layout"><div className="skeleton loading-poster" /><div><Lines title /><div className="skeleton loading-action" /></div></div>
      : kind === 'shorts' ? <div className="loading-portrait" />
      : kind === 'library' ? <div className="loading-library-layout"><Lines title /><div className="media-grid">{Array.from({length:12},(_,index)=><div key={index}><div className="skeleton loading-thumbnail" /><div className="skeleton loading-caption" /></div>)}</div></div>
      : <div className="loading-document"><Lines title /><div className="loading-document-columns"><div className="loading-document-nav">{[0,1,2,3].map(index=><div className="skeleton loading-label" key={index}/>)}</div><div className="loading-document-content">{[0,1,2].map(index=><div className="loading-document-section" key={index}><div className="skeleton loading-label" /><Lines /></div>)}</div></div></div>}
    </div>
  </div>;
}
