import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Check, Copy, GithubLogo, Play, TerminalWindow } from '@phosphor-icons/react';
import { PublicLanguageSelect, PublicLocaleProvider, usePublicLocale } from '../components/PublicLocale';
import { ShortsDemo } from '../components/ShortsDemo';
import { publicPath } from '../public-site';
import '../landing.css';

const cliSource = 'https://github.com/VireloHQ/Virelo';
const webSource = 'https://github.com/VireloHQ/Virelo-Web';
const previewCopy = {
  home: 'Pick up where you left off, find your favorites, or browse something you haven’t watched yet.',
  player: 'Choose your audio and subtitles, set the quality, and keep a whole queue playing.'
} as const;

function LandingContent() {
  const { t, locale } = usePublicLocale();
  const [preview, setPreview] = useState<'home' | 'player'>('home');
  const [mode, setMode] = useState<'web' | 'cli'>('web');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const modeTabs = useRef<(HTMLButtonElement | null)[]>([]);
  const previewTabs = useRef<(HTMLButtonElement | null)[]>([]);

  function tabKey(event: KeyboardEvent, index: number, tabs: (HTMLButtonElement | null)[], select: (index: number) => void) {
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? (index + 1) % 2 : null;
    if (target === null) return;
    event.preventDefault(); select(target); tabs[target]?.focus();
  }
  async function copyCommand() {
    try { await navigator.clipboard.writeText('npx virelo'); setCopyState('copied'); }
    catch { setCopyState('error'); }
  }

  return <div className="landing-page">
    <a className="landing-skip" href="#landing-main">{t("Skip to content")}</a>
    <header className="landing-header">
      <div className="landing-header-inner">
        <Link to={publicPath(locale, 'landing')} className="landing-brand" aria-label={t("Virelo home")}><img src="/virelo-icon-180.png?v=ribbon-1" alt="" width="40" height="40"/><span>Virelo</span></Link>
        <nav className="landing-nav" aria-label={t("Landing page navigation")}><a href="#experience">{t("The experience")}</a><a href="#start">{t("Ways to watch")}</a><Link to={publicPath(locale, 'setup')}>{t("Setup guide")}</Link></nav>
        <div className="landing-header-actions"><PublicLanguageSelect /><a className="landing-github-link" href={webSource} target="_blank" rel="noreferrer" aria-label={t("Virelo Web on GitHub")}><GithubLogo weight="fill"/><span>GitHub</span></a><Link to="/app" reloadDocument className="landing-open-link">{t("Open Virelo")}</Link></div>
      </div>
    </header>

    <main id="landing-main" tabIndex={-1}>
      <section className="landing-hero" aria-labelledby="landing-title">
        <img className="landing-hero-art" src="/landing/hero-coast.webp" alt="" width="2000" height="1121" fetchPriority="high"/>
        <div className="landing-hero-shade"/>
        <div className="landing-hero-content landing-container">
          <h1 id="landing-title">{t("Your collection.")}<br/>{t("Now showing.")}</h1>
          <p>{t("Your video folders, ready to watch in your browser. No account, uploads or installation required.")}</p>
          <div className="landing-hero-actions"><Link to="/app" reloadDocument className="landing-button landing-button-primary"><Play weight="fill"/>{t("Open web player")}</Link><a href="#start" className="landing-button landing-button-secondary" onClick={()=>{setMode('cli');setCopyState('idle');}}><TerminalWindow/>{t("Run locally")}</a></div>
          <p className="landing-hero-note">{t("Free and open source.")}</p>
        </div>
      </section>

      <section className="landing-experience landing-container" id="experience" aria-labelledby="experience-title">
        <div className="landing-section-heading">
          <div><h2 id="experience-title">{t("Familiar to browse.")}<br/>{t("Entirely yours.")}</h2><p>{t("Virelo is a free, open-source video player for your own movies, series and Shorts.")}</p></div>
          <div className="landing-tabs" role="tablist" aria-label={t("Preview the Virelo app")}>{(['home','player'] as const).map((value,index)=><button key={value} id={'preview-tab-'+value} type="button" role="tab" aria-selected={preview===value} aria-controls="landing-preview" tabIndex={preview===value?0:-1} ref={node=>{previewTabs.current[index]=node;}} onClick={()=>setPreview(value)} onKeyDown={event=>tabKey(event,index,previewTabs.current,next=>setPreview(next===0?'home':'player'))}>{value==='home'?t("Library"):t("Player")}</button>)}</div>
        </div>
        <figure className="landing-preview" id="landing-preview" role="tabpanel" aria-labelledby={'preview-tab-'+preview} tabIndex={0}>
          <picture><source media="(max-width: 600px)" srcSet={preview==='home'?'/landing/library-mobile.webp':'/landing/player-mobile.webp'}/><img src={preview==='home'?'/landing/library-desktop.webp':'/landing/player-desktop.webp'} alt={preview==='home'?t("The actual Virelo Home screen with a featured video, Continue watching and personal library shelves."):t("The actual Virelo player with playback controls and a video queue.")} width="1440" height="1050" loading="lazy"/></picture>
          <figcaption><p>{t(previewCopy[preview])}</p><span><a href="/landing/library-credits.txt" target="_blank" rel="noreferrer">{t("Sample film credits")}</a></span></figcaption>
        </figure>
        <div className="landing-editorial-features">
          <article><h3>{t("Browse your way.")}</h3><p>{t("Search your collection or switch to Explorer for a folder tree and an address bar with path completion.")}</p></article>
          <article><h3>{t("Your playlists. Your order.")}</h3><p>{t("Save named playlists, drag videos into order, shuffle, or keep a vertical queue beside the player.")}</p></article>
          <article><h3>{t("A more comfortable volume.")}</h3><p>{t("Reduce sudden volume jumps between videos with optional volume leveling.")}</p></article>
          <article><h3>{t("Keep your place.")}</h3><p>{t("Come back to a video without starting over. Your watch progress stays with your library.")}</p></article>
          <article><h3>{t("Make it feel like yours.")}</h3><p>{t("Choose from four player styles, set an accent color, and use Virelo in five languages.")}</p></article>
          <article><h3>{t("Original quality. More control.")}</h3><p>{t("Keep the original quality, choose audio and subtitles, change speed, or fine-tune the picture.")}</p></article>
        </div>
      </section>

      <section className="landing-shorts landing-container" id="shorts" aria-labelledby="shorts-title">
        <div className="landing-shorts-copy">
          <h2 id="shorts-title">{t("Shorts.")}<br/>{t("Your own feed.")}</h2>
          <p>{t("Your portrait clips deserve more than a folder. Virelo brings them together in Shorts, ready to swipe through whenever you have a moment.")}</p>
          <ul><li>{t("A fresh mix every time you open Shorts.")}</li><li>{t("Swipe to the next video. Tap to pause.")}</li><li>{t("Keep favorites close. Keep your files private.")}</li></ul>
          <Link to="/app" reloadDocument className="landing-button landing-button-primary"><Play weight="fill"/>{t("Try Virelo Shorts")}</Link>
          <p className="landing-shorts-note">{t("Choose your video folder, then open Shorts.")}</p>
        </div>
        <ShortsDemo />
      </section>

      <section className="landing-start" id="start" aria-labelledby="start-title">
        <div className="landing-container landing-start-layout">
          <div className="landing-start-copy"><h2 id="start-title">{t("Start with")}<br/>{(locale==='en'||locale==='ko')&&' '}{t("a folder.")}</h2><p>{t("Open Virelo in your browser, or make a local library available around your home.")}</p><div id="privacy" className="landing-privacy"><h3>{t("Your files stay yours.")}</h3><p>{t("The web player reads the folders you choose on this device. Your video files aren’t uploaded to Virelo.")}</p></div></div>
          <div className="landing-start-options">
            <div className="landing-tabs" role="tablist" aria-label={t("Choose how to use Virelo")}>{(['web','cli'] as const).map((value,index)=><button key={value} id={'start-tab-'+value} type="button" role="tab" aria-selected={mode===value} aria-controls="landing-start-panel" tabIndex={mode===value?0:-1} ref={node=>{modeTabs.current[index]=node;}} onClick={()=>{setMode(value);setCopyState('idle');}} onKeyDown={event=>tabKey(event,index,modeTabs.current,next=>{setMode(next===0?'web':'cli');setCopyState('idle');})}>{value==='web'?t("In your browser"):t("Run locally")}</button>)}</div>
            <div className="landing-start-panel" id="landing-start-panel" role="tabpanel" aria-labelledby={'start-tab-'+mode} tabIndex={0}>
              {mode==='web'?<>
                <h3>{t("No install. Just your videos.")}</h3>
                <p>{t("Choose a folder and start watching. Use Virelo in a browser, or add it to your home screen as a PWA where supported.")}</p>
                <ol className="landing-steps"><li>{t("Open the web player.")}</li><li>{t("Choose a folder and allow read access.")}</li><li>{t("Pick something to watch.")}</li></ol>
                <Link to="/app" reloadDocument className="landing-button landing-button-primary"><Play weight="fill"/>{t("Open web player")}</Link>
                <p className="landing-small">{t("Folder access and playback support depend on your browser.")}</p>
              </>:<>
                <h3>{t("One command. Your home cinema.")}</h3>
                <p>{t("Open a terminal in your video folder and start Virelo. Keep it local, or enable access from devices on your trusted network.")}</p>
                <ul className="landing-cli-features">
                  <li>{t("Movie and series info, posters and backdrops, matched automatically.")}</li>
                  <li>{t("Separate accounts, personal playlists and library permissions.")}</li>
                  <li>{t("Private announcements and optional, disclosed activity monitoring.")}</li>
                </ul>
                <div className="landing-command"><code>npx virelo</code><button type="button" onClick={()=>void copyCommand()} aria-label={t("Copy npx virelo command")}>{copyState==='copied'?<Check weight="bold"/>:<Copy/>}<span>{copyState==='copied'?t("Copied"):t("Copy")}</span></button></div>
                <p className="landing-copy-status" role="status">{copyState==='error'?t("Copy isn’t available here. Select the command above and copy it manually."):copyState==='copied'?t("Command copied. Open a terminal in your video folder and paste it."):''}</p>
                <Link to={publicPath(locale, 'setup')} className="landing-text-link">{t("Setup and network guide")}</Link>
                <p className="landing-small">{t("Requires Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines. Windows, macOS, Linux and Android via Termux. Network access is opt-in; don’t expose Virelo directly to the public internet.")}</p>
              </>}
            </div>
          </div>
        </div>
      </section>

      <section className="landing-faq landing-container" aria-labelledby="faq-title"><h2 id="faq-title">{t("A few things to know.")}</h2><div className="landing-faq-list">
        <details><summary>{t("Is Virelo free and open source?")}</summary><p>{t("Yes. Virelo is free and open source under AGPL-3.0-only. The source code is available on GitHub.")}</p></details>
        <details><summary>{t("What is the difference between the web player and the self-hosted server?")}</summary><p>{t("The web player opens files on the device you are using and needs no account. The self-hosted npm version runs on your computer and adds accounts, library permissions, automatic movie and series metadata, and network playback.")}</p></details>
        <details><summary>{t("Does Virelo upload my videos?")}</summary><p>{t("No. The web player reads only the folders you choose, and your video files stay on your device. Favorites, thumbnails and watch progress are stored in this browser.")}</p></details>
        <details><summary>{t("Can I run Virelo without installing it globally?")}</summary><p>{t("Yes. Open a terminal in your video folder and run")}{' '}<code>npx virelo</code>{t(".")}</p></details>
        <details><summary>{t("Can I watch from another device?")}</summary><p>{t("Yes. Run")}{' '}<code>npx virelo --host 0.0.0.0</code>{' '}{t("on a trusted local network, then open the host computer’s local address from your other device. The browser-only player reads files on the device you’re using.")}</p></details>
        <details><summary>{t("Will every video work in my browser?")}</summary><p>{t("Playback depends on your browser’s video codecs. The web player supports local audio conversion and embedded text subtitles for supported files. For broader compatibility, use the CLI with FFmpeg. See the")}{' '}<Link to={publicPath(locale, 'setup')}>{t("setup guide")}</Link>{' '}{t("for details.")}</p></details>
      </div></section>

      <section className="landing-closing landing-container" aria-labelledby="closing-title"><div><h2 id="closing-title">{t("Make tonight")}<br/>{t("a movie night.")}</h2><p>{t("Your videos are already there. Give them a place to play.")}</p></div><Link to="/app" reloadDocument className="landing-button landing-button-primary"><Play weight="fill"/>{t("Open Virelo")}</Link></section>
    </main>

    <footer className="landing-footer landing-container"><Link to={publicPath(locale, 'landing')} className="landing-brand" aria-label={t("Virelo home")}><img src="/virelo-icon-180.png?v=ribbon-1" alt="" width="32" height="32"/><span>Virelo</span></Link><p>{t("Your private video library.")}</p><nav aria-label={t("Footer navigation")}><Link to={publicPath(locale, 'setup')}>{t("Setup guide")}</Link><a href={webSource} target="_blank" rel="noreferrer">{t("Web source")}</a><a href={cliSource} target="_blank" rel="noreferrer">{t("CLI source")}</a><a href="https://www.npmjs.com/package/virelo" target="_blank" rel="noreferrer">npm</a></nav></footer>
  </div>;
}

export function LandingView() {
  return <PublicLocaleProvider page="landing"><LandingContent /></PublicLocaleProvider>;
}
