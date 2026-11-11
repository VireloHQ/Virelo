import { t, useLocale } from '../i18n';
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Play } from '@phosphor-icons/react';
import { Button } from '@heroui/react';
import { api } from '../api';
import { useUIStore } from '../store';
import { MediaCard } from '../components/MediaCard';
import { PageSkeleton } from '../components/PageSkeleton';
import { Select } from '../components/Select';
import { FAVORITES_PAGE_SIZE, nextFavoritesPage } from '../utils/favorites';
import type { SortKey } from '../types';

const SORT_OPTIONS = [
  { value: 'title', label: 'Title' }, { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' }, { value: 'duration', label: 'Longest' }
];

export function FavoritesView() {
  useLocale();
  const navigate = useNavigate();
  const search = useUIStore(s => s.search);
  const [sort, setSort] = useState<SortKey>('title');
  const query = useInfiniteQuery({
    queryKey: ['favorites', search, sort],
    queryFn: ({ pageParam }) => api.media({ liked: 1, search, sort, offset: pageParam, limit: FAVORITES_PAGE_SIZE }),
    initialPageParam: 0,
    getNextPageParam: (_page, pages) => nextFavoritesPage(pages)
  });
  const items = query.data?.pages.flat() ?? [];
  if (query.isLoading) return <PageSkeleton kind="library" />;
  return <div className="content-view favorites-view">
    <div className="content-heading">
      <div><h1>{t("Favorites")}</h1><p>{t("Your saved videos and Shorts.")}</p></div>
      <div className="heading-controls">
        <Select label={t("Sort favorites")} value={sort} options={SORT_OPTIONS.map(option=>({...option,label:t(option.label)}))} onChange={value => setSort(value as SortKey)} />
        {items.length > 0 && <Button className="play-all-btn" onPress={() => void navigate({
          to:'/app/watch/$mediaId', params:{mediaId:String(items[0].id)},
          search:{queue:true,favorites:true,sort,search:search||undefined}
        })}><Play weight="fill"/> {t("Play all")}</Button>}
      </div>
    </div>
    {query.isError && <div className="favorites-feedback" role="alert">
      <p>{t("Could not load favorites. Your saved videos have not been deleted.")}</p>
      <Button variant="secondary" onPress={() => void query.refetch()}>{t("Try again")}</Button>
    </div>}
    {items.length > 0 ? <div className="media-grid">{items.map(item => <MediaCard key={item.id} item={item}
      layout="landscape" short={Boolean(item.width && item.height && item.height > item.width)} />)}</div>
      : !query.isError && <div className="favorites-empty"><h2>{search ? t("No matching favorites") : t("No favorites yet")}</h2>
        <p>{search ? t("Try another search.") : t("Use the heart on a video or Short to save it here.")}</p>
        <Link to="/app/library">{t("Browse library")}</Link>
      </div>}
    {query.hasNextPage && <div className="favorites-more"><Button variant="secondary" isPending={query.isFetching}
      onPress={() => void query.fetchNextPage()}>{t("Show more")}</Button></div>}
  </div>;
}
