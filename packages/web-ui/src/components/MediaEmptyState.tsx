import type { ReactNode } from 'react';
import './MediaEmptyState.css';

const marks = {
  home: <><path className="empty-art-detail" d="M74 53h9m-9 12h9m-9 12h9m-9 12h9m-9 12h9m80-48h9m-9 12h9m-9 12h9m-9 12h9m-9 12h9"/><path className="empty-art-mark" d="m115 63 23 14-23 14z" strokeLinejoin="round"/></>,
  folder: <><path className="empty-art-mark" d="M96 68v-7a5 5 0 0 1 5-5h15l7 7h24a5 5 0 0 1 5 5v24a5 5 0 0 1-5 5h-46a5 5 0 0 1-5-5z" strokeLinejoin="round"/><path d="m119 74 14 8-14 8z" stroke="none" className="empty-art-play"/></>,
  favorites: <path className="empty-art-mark" d="M124 97 105 79a13 13 0 0 1 19-18 13 13 0 0 1 19 18z" strokeLinejoin="round"/>,
  playlists: <><path className="empty-art-mark" d="M96 64h46M96 77h32M96 90h28" strokeLinecap="round"/><path className="empty-art-play" d="m135 79 16 9-16 9z" stroke="none"/></>,
  search: <><circle className="empty-art-mark" cx="120" cy="73" r="16"/><path className="empty-art-mark" d="m132 85 12 12" strokeLinecap="round"/></>,
  shorts: <><path className="empty-art-mark" d="m118 66 16 11-16 11z" strokeLinejoin="round"/><path className="empty-art-detail" d="M118 51h12m-12 52h12" strokeLinecap="round"/></>
};

export function MediaEmptyState({ kind, title, heading: Heading = 'h2', className, children }: {
  kind: keyof typeof marks;
  title: string;
  heading?: 'h1' | 'h2' | 'h3';
  className?: string;
  children?: ReactNode;
}) {
  return <div className={className ? 'media-empty '+className : 'media-empty'} data-art={kind}>
    <div className="media-empty__body">
      <svg className="media-empty__art" viewBox="0 0 248 152" width="248" height="152" aria-hidden="true" focusable="false">
        <ellipse className="empty-art-shadow" cx="124" cy="128" rx="83" ry="9"/>
        <g className="empty-art-stack" strokeWidth="1.4">
          <rect x="37" y="45" width="105" height="66" rx="12" transform="rotate(-13 89 78)"/>
          <rect x="106" y="45" width="105" height="66" rx="12" transform="rotate(13 159 78)"/>
          <path className="empty-art-detail" d="m46 70 7 30m146-30-7 30" strokeLinecap="round"/>
        </g>
        {kind === 'shorts'
          ? <rect className="empty-art-face" x="97" y="32" width="54" height="90" rx="11"/>
          : <rect className="empty-art-face" x="62" y="38" width="124" height="80" rx="14"/>}
        {marks[kind]}
      </svg>
      <Heading>{title}</Heading>
      {children}
    </div>
  </div>;
}
