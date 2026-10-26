import { Trans } from '../i18n/Trans';
import { t, useLocale } from '../i18n';
import { useState } from 'react';
import { Input } from '@heroui/react';
import { ListPlus } from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Select } from './Select';
import { playlistName } from '../utils/playlist-values';
import './Playlists.css';

export function SavePlaylist({ mediaIds, label = 'Add to playlist' }: { mediaIds: number[]; label?: string }) {
  useLocale();
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false), [name, setName] = useState(''), [target, setTarget] = useState('new');
  const [notice, setNotice] = useState('');
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: api.playlists, enabled });
  return <div className="save-playlist">
    <ConfirmationDialog triggerLabel={t(label)} triggerIcon={<ListPlus aria-hidden="true"/>} title={t("Save to playlist")} confirmLabel={t("Save")} confirmVariant="primary"
      onOpen={() => { setEnabled(true); void playlists.refetch({ cancelRefetch: false }); setName(''); setTarget('new'); setNotice(''); }}
      onConfirm={async () => {
        if (!mediaIds.length) throw new Error('Choose at least one video.');
        const current = playlists.data?.find(item => item.id === Number(target));
        const saved = target === 'new' ? await api.createPlaylist({ name: playlistName(name), mediaIds })
          : current ? await api.updatePlaylist(current.id, { revision: current.revision, mediaIds, append: true })
          : (() => { throw new Error('Reload the playlist list and try again.'); })();
        await client.invalidateQueries({ queryKey: ['playlists'] });
        await client.invalidateQueries({ queryKey: ['playlist', saved.id] });
        setNotice(t('Saved to {name}.',{name:saved.name}));
      }}>
      <div className="playlist-form">
        <Select label={t("Playlist")} value={target} options={[{ value: 'new', label: t('New playlist') },
          ...(playlists.data ?? []).map(item => ({ value: String(item.id), label: item.name }))]} onChange={setTarget}/>
        {target === 'new' && <label className="playlist-field"><span>{t("Playlist name")}</span><Input autoFocus aria-label={t("Playlist name")} maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>}
        <p>{t('{count} videos',{count:mediaIds.length})}</p>
        {target !== 'new' && <button type="button" onClick={() => void playlists.refetch()}>{t("Refresh playlists")}</button>}
        {playlists.isError && <p className="error-copy" role="alert"><Trans message="Could not load existing playlists. {value0}" values={{value0:<button type="button" onClick={() => void playlists.refetch()}>{t("Try again")}</button>}}/></p>}
      </div>
    </ConfirmationDialog>
    {notice && <span className="playlist-notice" role="status">{t(notice)}</span>}
  </div>;
}
