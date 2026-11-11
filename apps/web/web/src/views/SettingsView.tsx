import { Trans } from '../i18n/Trans';
import { t, useLocale } from '../i18n';
import { PageSkeleton } from '../components/PageSkeleton';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Switch } from '@heroui/react';
import { ArrowLeft, ArrowsClockwise, CheckCircle, DeviceMobile, FolderPlus, Folders, HardDrives, ImageSquare, PlayCircle, ShieldCheck, Trash, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { ScanProgress } from '../components/ScanProgress';
import { Select } from '../components/Select';
import { SettingsNavigation } from '../components/SettingsNavigation';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import { QueueLayoutSetting } from '../components/QueueLayoutSetting';
import { AppearanceSettings } from '../components/AppearanceSettings';
import { Palette } from '@phosphor-icons/react';
import { VolumeLevelingSetting } from '../components/VolumeLevelingSetting';
import { SharingSettings } from '../components/ShareButton';
import { QrCode } from '@phosphor-icons/react';
import type { QueueBehavior } from '../types';
import { BrowserBackupSettings } from '../components/BrowserBackup';
import { Database } from '@phosphor-icons/react';

const settingsSections = [
  { id:'libraries', label:'Libraries', description:'Folders and browser access', icon:Folders },
  { id:'metadata', label:'Metadata', description:'Titles and artwork', icon:ImageSquare },
  { id:'playback', label:'Playback', description:'What plays next', icon:PlayCircle },
  { id:'appearance', label:'Appearance', description:'Player style and accent color', icon:Palette },
  { id:'sharing', label:'Sharing', description:'App links and QR codes', icon:QrCode },
  { id:'shorts', label:'Shorts', description:'Videos in your vertical feed', icon:DeviceMobile },
  { id:'backup', label:'Export / Import', description:'Settings and library backups', icon:Database },
  { id:'privacy', label:'Privacy', description:'Your files stay on your device', icon:ShieldCheck }
] as const;

const QUEUE_OPTIONS = [
  { value: 'auto', label: 'Auto next, stop at end' },
  { value: 'loop', label: 'Auto next, loop folder' },
  { value: 'manual', label: 'Manual next only' }
];

type SettingsSectionId = (typeof settingsSections)[number]['id'];

export function SettingsView() {
  useLocale();
  const client = useQueryClient();
  const settingsQuery = useQuery({ queryKey:['settings'], queryFn:api.settings });
  const libraries = useQuery({ queryKey:['libraries'], queryFn:api.libraries });
  const capabilities = useQuery({ queryKey:['capabilities'], queryFn:api.capabilities });
  const scan = useQuery({ queryKey:['scan'], queryFn:api.scanStatus, refetchInterval:(query)=>query.state.data?.running ? 400 : 2_000 });
  const form = settingsQuery.data;
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => {
    const value = new URLSearchParams(window.location.search).get('section');
    return settingsSections.find(section => section.id === value)?.id ?? 'libraries';
  });
  const [mobileDetail,setMobileDetail]=useState(() => new URLSearchParams(window.location.search).get('section') === 'backup');
  const openSection=(id:string)=>{
    setActiveSection(id as SettingsSectionId);
    setMobileDetail(true);
    if(window.matchMedia('(max-width: 900px)').matches) window.requestAnimationFrame(()=>document.querySelector<HTMLElement>(`#settings-title-${id}`)?.focus());
  };
  const closeSection=()=>{
    setMobileDetail(false);
    window.requestAnimationFrame(()=>document.getElementById(`settings-nav-${activeSection}`)?.focus());
  };

  const invalidateLibrary = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey:['libraries'] }),
      client.invalidateQueries({ queryKey:['home'] }),
      client.invalidateQueries({ queryKey:['media'] }),
      client.invalidateQueries({ queryKey:['thumbnail'] }),
      client.invalidateQueries({ queryKey:['folders'] }),
      client.invalidateQueries({ queryKey:['shorts'] }),
      client.invalidateQueries({ queryKey:['scan'] })
    ]);
  };
  const save = useMutation({ scope:{id:'settings'}, mutationFn:api.saveSettings, onSuccess:(data)=>{ client.setQueryData(['settings'], data); void client.invalidateQueries({ queryKey:['shorts'] }); } });
  const add = useMutation({ mutationFn:api.addLibrary, onSuccess:invalidateLibrary });
  const reconnect = useMutation({ mutationFn:(id:number)=>api.reconnectLibrary(id), onSuccess:invalidateLibrary });
  const libraryError=[add.error,reconnect.error].find(error=>error&&error.name!=='AbortError');
  const remove = useMutation({ mutationFn:(id:number)=>api.removeLibrary(id), onSuccess:invalidateLibrary });
  const clearMetadata = useMutation({mutationFn:api.clearAllMetadata,onSuccess:()=>client.invalidateQueries({predicate:(query)=>['home','media','related','shorts','watch-queue','queue','search'].includes(String(query.queryKey[0]))})});

  if (!form) return <PageSkeleton kind="settings" />;
  const startScan = async () => {
    await api.startScan();
    await client.invalidateQueries({ queryKey:['scan'] });
    window.setTimeout(() => { void invalidateLibrary(); }, 500);
  };

  return <div className={`content-view settings-view${mobileDetail?' settings-detail-open':''}`}>
    <header className="settings-heading"><h1>{t("Settings")}</h1></header>
    {save.error && <div className="settings-save-error"><p className="error-copy" role="alert">{t(save.error.message)}</p><Button variant="secondary" onPress={()=>save.mutate(save.variables!)}>{t("Try again")}</Button></div>}

    <div className="settings-layout">
      <SettingsNavigation sections={settingsSections} activeSection={activeSection} detailOpen={mobileDetail} onSelect={openSection}/>

      <div className="settings-content">
        <button type="button" className="settings-back" onClick={closeSection}><ArrowLeft aria-hidden="true"/> {t("All settings")}</button>
        {activeSection==='appearance'&&<AppearanceSettings/>}
        {activeSection === 'sharing' && <SharingSettings webOnly/>}
        {activeSection === 'backup' && <BrowserBackupSettings/>}
        {activeSection === 'libraries' && <section id="settings-panel-libraries" className="settings-card settings-section" aria-labelledby="settings-title-libraries">
          <div className="settings-card-head">
            <div><h2 id="settings-title-libraries" tabIndex={-1}>{t("Libraries")}</h2><p>{t("Choose folders that Virelo can read in this browser.")}</p></div>
            <Button isPending={add.isPending} onPress={()=>add.mutate()}><FolderPlus/> {t("Add folder")}</Button>
          </div>
          {!capabilities.data?.secureContext && <p className="browser-warning"><WarningCircle/> {t("Folder access requires HTTPS or localhost.")}</p>}
          {capabilities.data && !capabilities.data.directoryPicker && <p className="browser-warning"><WarningCircle/> {t("This browser can use selected files for the current session, but may ask for the folder again after a reload.")}</p>}
          {libraryError&&<p className="error-copy" role="alert">{t(libraryError.message)}</p>}

          <div className="library-list">
            {libraries.data?.map((library) => <div key={library.id}>
              <div>
                <strong>{library.label}</strong>
                <span className={library.connected ? 'library-connected' : 'library-disconnected'}>{library.connected ? <CheckCircle/> : <WarningCircle/>}{library.connected ? t("Connected") : t("Reconnect required")}{!library.persistent && <> · {t("Temporary")}</>}</span>
              </div>
              <div className="library-actions">
                {!library.connected && <Button size="sm" variant="secondary" isPending={reconnect.isPending} onPress={()=>reconnect.mutate(library.id)}>{t("Reconnect")}</Button>}
                <Button isIconOnly variant="ghost" aria-label={t("Remove {value0}", { value0: library.label })} onPress={()=>remove.mutate(library.id)}><Trash/></Button>
              </div>
            </div>)}
            {libraries.data?.length === 0 && <p className="settings-empty-copy">{t("No folders selected.")}</p>}
          </div>

          <SettingSwitch checked={save.isPending&&save.variables.audioAnalysisEnabled!==undefined?save.variables.audioAnalysisEnabled:form.audioAnalysisEnabled} onChange={(value)=>save.mutate({audioAnalysisEnabled:value})} title={t("Analyze audio during scans")} description={t("Measure loudness for more consistent playback. Scans take longer.")}/>
          <div className="scan-strip">
            {scan.data?.running ? <ScanProgress status={scan.data} compact/> : <div><CheckCircle/><span><strong>{t(scan.data?.message || 'Ready')}</strong></span></div>}
            <Button variant="secondary" isDisabled={scan.data?.running || !libraries.data?.length} onPress={()=>void startScan()}><ArrowsClockwise/> {t("Scan now")}</Button>
          </div>
        </section>}

        {activeSection === 'metadata' && <section id="settings-panel-metadata" className="settings-card settings-section" aria-labelledby="settings-title-metadata">
          <div className="settings-card-head"><div><h2 id="settings-title-metadata" tabIndex={-1}>{t("Metadata")}</h2><p>{t("Manage titles and artwork stored in this browser.")}</p></div></div>
          <div className="setting-row settings-action-row"><div className="setting-copy"><div><strong>{t("Clear all metadata")}</strong><p>{t("Reset titles and remove matched descriptions and artwork from every added library. Videos, generated thumbnails, favorites and watch progress stay intact.")}</p></div></div><ConfirmationDialog triggerLabel={t("Clear all metadata")} title={t("Clear all metadata?")} confirmLabel={t("Clear metadata")} onConfirm={()=>clearMetadata.mutateAsync()}><p><Trans message="Clear matched titles, descriptions and artwork from {value0}. Titles will return to filenames." values={{value0:<strong>{t("every added library")}</strong>}}/></p><p>{t("Your videos, generated thumbnails, favorites and watch progress will stay intact.")}</p></ConfirmationDialog></div>
          <div role="status">{clearMetadata.isSuccess&&<p><Trans message="Metadata cleared for {value0} videos." values={{value0:clearMetadata.data.cleared}}/></p>}</div>
        </section>}

        {activeSection === 'playback' && <section id="settings-panel-playback" className="settings-card settings-section" aria-labelledby="settings-title-playback">
          <div className="settings-card-head"><div><h2 id="settings-title-playback" tabIndex={-1}>{t("Playback")}</h2><p>{t("Choose what happens when a video ends in a folder queue.")}</p></div></div>
          <QueueLayoutSetting/>
          <VolumeLevelingSetting/>
          <div className="setting-row"><div className="setting-copy"><div><strong>{t("Queue advance")}</strong><p>{t("Auto-advance, loop, or manually step through the folder.")}</p></div></div>
            <Select className="settings-picker" label={t("Queue advance")} value={save.isPending&&save.variables.queueBehavior?save.variables.queueBehavior:form.queueBehavior} options={QUEUE_OPTIONS.map(option=>({...option,label:t(option.label)}))} align="end" onChange={(value)=>save.mutate({queueBehavior:value as QueueBehavior})}/></div>
        </section>}

        {activeSection === 'shorts' && <section id="settings-panel-shorts" className="settings-card settings-section" aria-labelledby="settings-title-shorts">
          <div className="settings-card-head"><div><h2 id="settings-title-shorts" tabIndex={-1}>{t("Shorts")}</h2><p>{t("Choose which local videos appear in the vertical feed.")}</p></div></div>
          <SettingSwitch checked={save.isPending&&save.variables.shortsIncludeLandscapes!==undefined?save.variables.shortsIncludeLandscapes:form.shortsIncludeLandscapes} onChange={(value)=>save.mutate({shortsIncludeLandscapes:value})} title={t("Include landscape videos")} description={t("Fit landscape videos by width in the Shorts player.")}/>
        </section>}

        {activeSection === 'privacy' && <section id="settings-panel-privacy" className="settings-card settings-section compact-card" aria-labelledby="settings-title-privacy">
          <div className="settings-card-head"><div><h2 id="settings-title-privacy" tabIndex={-1}>{t("Privacy")}</h2><p>{t("Virelo Web runs entirely in your browser.")}</p></div></div>
          <div className="privacy-facts">
            <div><ShieldCheck/><span><strong>{t("No file uploads")}</strong><small>{t("Video data stays on this device.")}</small></span></div>
            <div><HardDrives/><span><strong>{t("Browser storage")}</strong><small>{t("Saved in this browser.")}</small></span></div>
            <div><WarningCircle/><span><strong>{t("You control access")}</strong><small>{t("Remove a library at any time or revoke site permissions in your browser.")}</small></span></div>
          </div>
        </section>}
      </div>
    </div>
    <footer className="settings-legal" aria-label={t("Virelo licensing")}>
      <span>{t("Copyright (c) 2026 Virelo contributors. No warranty.")}</span>
      <nav aria-label={t("Source and license")}><a href="https://github.com/VireloHQ/Virelo" target="_blank" rel="noreferrer">{t("Source code")}</a><a href="/LICENSE.txt" target="_blank" rel="noreferrer">{t("AGPL-3.0-only")}</a></nav>
    </footer>
  </div>;
}

function SettingSwitch({ checked, onChange, title, description }: { checked:boolean; onChange:(value:boolean)=>void; title:string; description:string }) {
  return <div className="setting-row"><div className="setting-copy"><div><strong>{title}</strong><p>{description}</p></div></div><Switch isSelected={checked} onChange={onChange} aria-label={title}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div>;
}
