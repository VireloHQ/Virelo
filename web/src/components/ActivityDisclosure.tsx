import { Trans } from '../i18n/Trans';
import { t, useLocale, getLocale } from '../i18n';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Eye } from '@phosphor-icons/react';
import type { ActivityPolicy } from '../../../src/auth-types';
import { api } from '../api';
import { playbackActivity } from '../hooks/usePlaybackActivity';

export function ActivityDisclosure({policy,compact=false}:{policy?:ActivityPolicy;compact?:boolean}) {
  useLocale();
  const ref=useRef<HTMLDetailsElement>(null);
  useLayoutEffect(()=>{
    const element=ref.current,shell=element?.closest<HTMLElement>('.app-shell');if(!element||!shell)return;
    const update=()=>shell.style.setProperty('--activity-notice-height',element.offsetHeight+'px');
    const observer=new ResizeObserver(update);observer.observe(element);update();
    return()=>{observer.disconnect();shell.style.removeProperty('--activity-notice-height');};
  },[policy?.enabled,compact]);
  if(!policy?.enabled)return null;
  const copy=<p><Trans message="Administrators can see online status and playback, and keep sign-in, playback, account/library operations, favorites and playlist change logs for up to {value0} days ({value1} events maximum). Passwords, IP addresses and file paths are not included." values={{value0:policy.retentionDays,value1:policy.maxEvents.toLocaleString(getLocale())}}/></p>;
  return compact?<details ref={ref} data-notice-version={policy.revision} className="activity-disclosure activity-disclosure-compact" aria-label={t("Activity monitoring notice")}><summary><Eye aria-hidden="true"/>{t("Activity monitoring is on")} <span><Trans message="· {value0}-day history" values={{value0:policy.retentionDays}}/></span></summary>{copy}</details>:<aside className="activity-disclosure" aria-label={t("Activity monitoring notice")}><Eye aria-hidden="true"/><div><strong>{t("Activity monitoring is on")}</strong>{copy}</div></aside>;
}

export function ActivityReporter({policy}:{policy?:ActivityPolicy}) {
  useEffect(()=>{
    if(!policy?.enabled)return;
    // getRandomValues also works on plain HTTP LAN addresses.
    let tabId=Array.from(crypto.getRandomValues(new Uint32Array(4)),value=>value.toString(16).padStart(8,'0')).join('');
    try {
      const previous=sessionStorage.getItem('virelo-activity-tab');
      if(previous&&/^[a-zA-Z0-9-]{16,80}$/.test(previous))tabId=previous;
      else sessionStorage.setItem('virelo-activity-tab',tabId);
    } catch { /* Storage can be disabled; presence still expires after 90 seconds. */ }
    let timer:number|undefined,stopped=false,inFlight=false;
    const send=async()=>{
      if(stopped||inFlight)return;
      const notice=document.querySelector<HTMLElement>('.activity-disclosure-compact');
      if(notice?.dataset.noticeVersion!==String(policy.revision)||!notice.getClientRects().length)return;
      inFlight=true;
      try{await api.reportActivity({...playbackActivity(),tabId,noticeVersion:policy.revision});}
      catch{/* Monitoring must not interrupt playback or sign-in recovery. */}
      finally{inFlight=false;}
    };
    const schedule=()=>{clearTimeout(timer);timer=window.setTimeout(()=>void send(),250);};
    schedule();
    const interval=window.setInterval(()=>void send(),20_000);
    window.addEventListener('virelo-activity-change',schedule);
    return()=>{stopped=true;clearTimeout(timer);clearInterval(interval);window.removeEventListener('virelo-activity-change',schedule);};
  },[policy?.enabled,policy?.revision]);
  return null;
}
