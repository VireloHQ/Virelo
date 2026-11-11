import { t, useLocale } from '../i18n';
import { useState } from 'react';
import { Button, Input, buttonVariants } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ListPlus, Play, Queue, Shuffle } from '@phosphor-icons/react';
import { api } from '../api';
import { PageSkeleton } from '../components/PageSkeleton';
import { PlaybackQueue } from '../components/PlaybackQueue';
import { PlaylistArtwork } from '../components/PlaylistArtwork';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { usePlaybackQueue } from '../hooks/usePlaybackQueue';
import { playlistName } from '../utils/playlist-values';
import type { PlaylistDetail } from '../types';
import '../components/Playlists.css';

export function PlaylistsView() {
  useLocale();
  const navigate = useNavigate(), client = useQueryClient();
  const [name, setName] = useState('');
  const query = useQuery({ queryKey: ['playlists'], queryFn: api.playlists });
  const create = useMutation({
    mutationFn: () => api.createPlaylist({ name: playlistName(name), mediaIds: [] }),
    onSuccess: async playlist => { await client.invalidateQueries({ queryKey: ['playlists'] }); void navigate({ to: '/app/playlists/$playlistId', params: { playlistId: String(playlist.id) } }); }
  });
  return <div className="content-view playlists-view">
    <header className="content-heading"><div><h1>{t("Playlists")}</h1></div><Link to="/app/library">{t("Browse library")}</Link></header>
    <form className="playlist-create" onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(); }}>
      <label className="playlist-field"><span>{t("New playlist")}</span><Input aria-label={t("New playlist name")} maxLength={100} placeholder={t("Playlist name")} value={name} onChange={event => setName(event.target.value)}/></label>
      <Button type="submit" isPending={create.isPending} isDisabled={create.isPending || !name.trim()}>{t("Create playlist")}</Button>
    </form>
    {create.error && <p className="error-copy" role="alert">{t(create.error.message)}</p>}
    {query.isPending ? <p role="status">{t("Loading playlists…")}</p> : query.isError ? <div className="playlist-feedback" role="alert"><p>{t(query.error.message)}</p><Button variant="secondary" onPress={() => void query.refetch()}>{t("Try again")}</Button></div>
      : query.data.length ? <ul className="playlist-collection" aria-label={t("Saved playlists")}>{query.data.map(playlist => <li key={playlist.id}>
        <Link to="/app/playlists/$playlistId" params={{ playlistId: String(playlist.id) }}>
          <PlaylistArtwork playlist={playlist}/><div><h2 title={playlist.name}>{playlist.name}</h2><p>{t('{count} videos',{count:playlist.itemCount})}{playlist.unavailableCount ? ' · '+t('{count} unavailable videos',{count:playlist.unavailableCount}) : ''}</p></div><span>{t("Open")}</span>
        </Link>
      </li>)}</ul> : <div className="playlist-empty"><Queue/><h2>{t("No playlists yet")}</h2><p>{t("Create one above, add a video from its details, or save a playback queue.")}</p></div>}
  </div>;
}

export function PlaylistView() {
  useLocale();
  const { playlistId } = useParams({ from: '/app/playlists/$playlistId' });
  const id = Number(playlistId);
  const query = useQuery({ queryKey: ['playlist', id], queryFn: () => api.playlist(id), refetchOnWindowFocus: false });
  if (query.isPending) return <PageSkeleton kind="library"/>;
  if (query.isError) return <div className="content-view playlist-feedback" role="alert"><h1>{t("Playlist unavailable")}</h1><p>{t(query.error.message)}</p><Button variant="secondary" onPress={() => void query.refetch()}>{t("Try again")}</Button><Link to="/app/playlists">{t("All playlists")}</Link></div>;
  return <PlaylistEditor key={query.data.id + ':' + query.data.revision} playlist={query.data} reload={() => query.refetch().then(result => { if (result.error) throw result.error; })}/>;
}

function PlaylistEditor({ playlist, reload }: { playlist: PlaylistDetail; reload: () => Promise<unknown> }) {
  useLocale();
  const navigate = useNavigate(), client = useQueryClient();
  const [name, setName] = useState(playlist.name), [notice, setNotice] = useState('');
  const { queue, items, update } = usePlaybackQueue(playlist.items, playlist.items[0]?.id ?? 0);
  const dirty = name.trim() !== playlist.name || items.length !== playlist.items.length || items.some((item, index) => item.id !== playlist.items[index]?.id);
  const save = useMutation({
    mutationFn: () => api.updatePlaylist(playlist.id, { revision: playlist.revision, name: playlistName(name), mediaIds: items.map(item => item.id) }),
    onSuccess: saved => { client.setQueryData(['playlist', playlist.id], saved); void client.invalidateQueries({ queryKey: ['playlists'] }); }
  });
  const play = (index = 0, shuffle = false) => {
    if (dirty) { setNotice('Save your changes before starting playback.'); return; }
    const selected = items[shuffle ? Math.floor(Math.random() * items.length) : index];
    if (selected) void navigate({ to: '/app/watch/$mediaId', params: { mediaId: String(selected.id) }, search: { queue: true, playlistId: playlist.id, sort: shuffle ? 'random' : undefined } });
  };
  return <div className="content-view playlist-editor">
    <Link className="playlist-back" to="/app/playlists">{t("All playlists")}</Link>
    <header className="content-heading"><div><h1>{playlist.name}</h1><p>{t('{count} videos',{count:playlist.itemCount})}</p></div>
      <div className="heading-controls"><Button isDisabled={!items.length || dirty} onPress={() => play()}><Play weight="fill"/> {t("Play all")}</Button><Button variant="secondary" isDisabled={items.length < 2 || dirty} onPress={() => play(0, true)}><Shuffle/> {t("Shuffle")}</Button></div>
    </header>
    <form className="playlist-create" onSubmit={event => { event.preventDefault(); if (dirty && !save.isPending) save.mutate(); }}>
      <label className="playlist-field"><span>{t("Playlist name")}</span><Input aria-label={t("Playlist name")} maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
      <Button type="submit" isPending={save.isPending} isDisabled={!dirty || save.isPending}>{t("Save changes")}</Button>
    </form>
    {save.error && <div className="playlist-feedback" role="alert"><p>{t(save.error.message)}</p></div>}
    {notice && <p className="playlist-notice" role="status">{t(notice)}</p>}
    {playlist.unavailableCount > 0 && <p className="playlist-notice">{t('{count} videos are unavailable. Check library access.',{count:playlist.unavailableCount})}</p>}
    <PlaybackQueue editing items={items} activeIndex={-1} repeatMode="off" onRepeatChange={() => {}} onSelect={index => play(index)} state={queue} onEdit={update}
      headerActions={<Link to="/app/library" className={buttonVariants({variant:'secondary',className:'playlist-add-videos'})}><ListPlus aria-hidden="true"/>{t("Add videos")}</Link>}/>
    <footer className="playlist-management">
      <span role="status">{dirty ? t("Unsaved changes") : t("All changes saved")}</span>
      <div><ConfirmationDialog triggerLabel={t("Reload playlist")} title={t("Reload playlist?")} confirmLabel={t("Reload")} onConfirm={reload}><p>{t("Discard unsaved changes and reload?")}</p></ConfirmationDialog>
      <ConfirmationDialog triggerLabel={t("Delete playlist")} title={t("Delete playlist?")} confirmLabel={t("Delete playlist")} onConfirm={async () => {
        await api.deletePlaylist(playlist.id, playlist.revision); await client.invalidateQueries({ queryKey: ['playlists'] });
        client.removeQueries({ queryKey: ['playlist', playlist.id] }); void navigate({ to: '/app/playlists' });
      }}><p><strong>{playlist.name}</strong></p></ConfirmationDialog></div>
    </footer>
  </div>;
}
