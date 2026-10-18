import { PageSkeleton } from '../components/PageSkeleton';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Switch } from '@heroui/react';
import { ArrowLeft, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { LibrarySettings } from '../components/LibrarySettings';
import { Select } from '../components/Select';
import { SettingsNavigation } from '../components/SettingsNavigation';
import { ConfirmationDialog } from '../components/ConfirmationDialog';
import type { QueueBehavior, Settings } from '../types';
import { useAccount } from '../components/AccountSession';
import { AccountManager, AccountProfile } from '../components/AccountSettings';

const settingsSections = [
  { id:'account', label:'Account', description:'Your name, password and sign-in' },
  { id:'accounts', label:'Account Manager', description:'Users, library access and permissions' },
  { id:'libraries', label:'Libraries', description:'Folders and automatic scanning' },
  { id:'network', label:'Metadata', description:'Titles, posters and artwork' },
  { id:'playback', label:'Playback', description:'What plays next' },
  { id:'shorts', label:'Shorts', description:'Videos in your vertical feed' },
  { id:'tools', label:'Advanced', description:'Media tool availability' },
] as const;
const QUEUE_OPTIONS = [
  { value: 'auto', label: 'Auto next, stop at end' },
  { value: 'loop', label: 'Auto next, loop folder' },
  { value: 'manual', label: 'Manual next only' }
];
type SettingsSectionId = (typeof settingsSections)[number]['id'];

export function SettingsView(){
  const session=useAccount();
  const isAdmin=Boolean(session?.user.isAdmin);
  const sections=settingsSections.filter(section=>isAdmin||['account','libraries','tools'].includes(section.id));
  const client=useQueryClient();
  const settingsQuery=useQuery({queryKey:['settings'],queryFn:api.settings});
  const health=useQuery({queryKey:['health'],queryFn:async()=>{const r=await fetch('/api/health');return r.json() as Promise<{ffmpeg:boolean;ffprobe:boolean}>;}});
  const [form,setForm]=useState<Settings|null>(null);
  const [activeSection,setActiveSection]=useState<SettingsSectionId>('account');
  const [mobileDetail,setMobileDetail]=useState(false);
  const openSection=(id:string)=>{
    setActiveSection(id as SettingsSectionId);
    setMobileDetail(true);
    if(window.matchMedia('(max-width: 900px)').matches) window.requestAnimationFrame(()=>document.querySelector<HTMLElement>(`#settings-title-${id}`)?.focus());
  };
  const closeSection=()=>{
    setMobileDetail(false);
    window.requestAnimationFrame(()=>document.getElementById(`settings-nav-${activeSection}`)?.focus());
  };
  useEffect(()=>{if(settingsQuery.data&&!form)setForm(settingsQuery.data);},[settingsQuery.data,form]);
  const save=useMutation({mutationFn:()=>api.saveSettings(form!),onSuccess:(data)=>{setForm(data);client.setQueryData(['settings'],data);}});
  const clearMetadata=useMutation({mutationFn:api.clearAllMetadata,onSuccess:()=>client.invalidateQueries({predicate:(query)=>['home','media','related','shorts','watch-queue','queue','search'].includes(String(query.queryKey[0]))})});
  if(!form)return <PageSkeleton kind="settings" />;
  const hasChanges=JSON.stringify(form)!==JSON.stringify(settingsQuery.data);
  return <div className={`content-view settings-view${mobileDetail?' settings-detail-open':''}`}>
    <header className="settings-heading"><h1>Settings</h1>{isAdmin&&['libraries','network','playback','shorts'].includes(activeSection)&&<div className="settings-heading-actions"><span aria-live="polite">{save.isSuccess&&!hasChanges&&<span className="settings-saved"><CheckCircle/> Saved</span>}</span><Button isPending={save.isPending} isDisabled={!hasChanges} onPress={()=>save.mutate()}>Save settings</Button></div>}</header>
    {save.error&&<p className="error-copy settings-save-error">{save.error.message}</p>}

    <div className="settings-layout">
      <SettingsNavigation sections={sections} activeSection={activeSection} onSelect={openSection}/>

      <div className="settings-content">
        <button type="button" className="settings-back" onClick={closeSection}><ArrowLeft aria-hidden="true"/> All settings</button>
        {activeSection==='account'&&<div id="settings-panel-account" className="settings-card settings-section"><AccountProfile/></div>}
        {activeSection==='accounts'&&isAdmin&&<div id="settings-panel-accounts" className="settings-card settings-section"><AccountManager/></div>}
        {activeSection==='libraries'&&<section id="settings-panel-libraries" className="settings-card settings-section" aria-labelledby="settings-title-libraries">
          <div className="settings-card-head"><div><h2 id="settings-title-libraries" tabIndex={-1}>Libraries</h2><p>Manage the folders Virelo scans for media.</p></div></div>
          <LibrarySettings/>
          {isAdmin&&<SettingSwitch checked={form.libraryWatchEnabled} onChange={(v)=>setForm({...form,libraryWatchEnabled:v})} title="Watch local folders" description="Monitor configured folders and scan when files change."/>}
        </section>}

        {activeSection==='network'&&<section id="settings-panel-network" className="settings-card settings-section" aria-labelledby="settings-title-network">
          <div className="settings-card-head"><div><h2 id="settings-title-network" tabIndex={-1}>Metadata</h2><p>Choose how Virelo matches your videos and finds artwork.</p></div></div>
          <SettingSwitch checked={form.externalMetadataEnabled} onChange={(v)=>setForm({...form,externalMetadataEnabled:v})} title="Online metadata" description="Match titles, summaries, genres and release years during scans. No account or API key required."/>
          <SettingSwitch checked={form.externalImagesEnabled} disabled={!form.externalMetadataEnabled} onChange={(v)=>setForm({...form,externalImagesEnabled:v})} title="Posters and artwork" description="Replace generated thumbnails with posters, backdrops and episode images."/>
          <div className="setting-row settings-action-row"><div className="setting-copy"><div><strong>Clear all metadata</strong><p>Reset titles and remove matched descriptions and artwork from every added library. Videos, generated thumbnails, favorites and watch progress stay intact. Existing videos will not be automatically matched again.</p></div></div><ConfirmationDialog triggerLabel="Clear all metadata" title="Clear all metadata?" confirmLabel="Clear metadata" onConfirm={()=>clearMetadata.mutateAsync()}><p>Clear matched titles, descriptions and artwork from <strong>every added library, including hidden libraries</strong>. Titles will return to filenames.</p><p>Your videos, generated thumbnails, favorites and watch progress will stay intact.</p><p>Existing videos will not be automatically matched again.</p></ConfirmationDialog></div>
          <div role="status">{clearMetadata.isSuccess&&<p>Metadata cleared for {clearMetadata.data.cleared} videos.</p>}</div>
        </section>}

        {activeSection==='playback'&&<section id="settings-panel-playback" className="settings-card settings-section" aria-labelledby="settings-title-playback">
          <div className="settings-card-head"><div><h2 id="settings-title-playback" tabIndex={-1}>Playback</h2><p>Choose what happens when a video ends in a folder queue.</p></div></div>
          <div className="setting-row"><div className="setting-copy"><div><strong>Queue advance</strong><p>Auto-advance, loop, or manually step through the folder.</p></div></div>
            <Select className="settings-picker" label="Queue advance" value={form.queueBehavior} options={QUEUE_OPTIONS} align="end" onChange={(value)=>setForm({...form,queueBehavior:value as QueueBehavior})}/></div>
        </section>}

        {activeSection==='shorts'&&<section id="settings-panel-shorts" className="settings-card settings-section" aria-labelledby="settings-title-shorts">
          <div className="settings-card-head"><div><h2 id="settings-title-shorts" tabIndex={-1}>Shorts</h2><p>Choose which videos appear in the vertical feed.</p></div></div>
          <SettingSwitch checked={form.shortsIncludeLandscapes} onChange={(v)=>setForm({...form,shortsIncludeLandscapes:v})} title="Include landscape videos" description="Add landscape videos with known dimensions to the Shorts feed."/>
        </section>}

        {activeSection==='tools'&&<section id="settings-panel-tools" className="settings-card settings-section compact-card" aria-labelledby="settings-title-tools">
          <div className="settings-card-head"><div><h2 id="settings-title-tools" tabIndex={-1}>Advanced</h2><p>Tools used for thumbnails and video compatibility.</p></div></div>
          <div className="tool-status"><span className={health.data?.ffmpeg?'ok':'warn'}>{health.data?.ffmpeg?<CheckCircle/>:<WarningCircle/>} FFmpeg {health.data?.ffmpeg?'available':'not found'}</span><span className={health.data?.ffprobe?'ok':'warn'}>{health.data?.ffprobe?<CheckCircle/>:<WarningCircle/>} ffprobe {health.data?.ffprobe?'available':'not found'}</span></div>
        </section>}
      </div>
    </div>
    <footer className="settings-legal" aria-label="Virelo licensing">
      <span>Copyright (c) 2026 Virelo contributors. No warranty.</span>
      <nav aria-label="Source and license"><a href="https://github.com/VireloHQ/Virelo" target="_blank" rel="noreferrer">Source code</a><a href="/LICENSE.txt" target="_blank" rel="noreferrer">AGPL-3.0-only</a></nav>
    </footer>
  </div>;
}

function SettingSwitch({checked,onChange,title,description,disabled=false}:{checked:boolean;onChange:(value:boolean)=>void;title:string;description:string;disabled?:boolean}){
  return <div className="setting-row"><div className="setting-copy"><div><strong>{title}</strong><p>{description}</p></div></div><Switch isSelected={checked} isDisabled={disabled} onChange={onChange} aria-label={title}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div>;
}
