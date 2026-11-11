import { t, useLocale } from '../i18n';
import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from '@heroui/react';
import { Check, Play } from '@phosphor-icons/react';
import { useAppearance } from './AppearanceProvider';
import { LanguageSettings } from './LanguageSettings';
import { Select } from './Select';
import { useLibraryLayout, type LibraryLayout } from '../hooks/useLibraryLayout';
import { appearanceVariables, DEFAULT_APPEARANCE, isAppearance, type Appearance } from '../utils/appearance';

const styles = [
  { value: 'classic', name: 'Virelo', description: 'The original controls' },
  { value: 'streamline', name: 'Streamline', description: 'Compact, left-aligned controls' },
  { value: 'theater', name: 'Theater', description: 'Large controls, minimal backdrop' },
  { value: 'centerstage', name: 'Centerstage', description: 'A floating, centered dock' }
] as const;
const colors = [
  ['Violet', '#c3a6ff'], ['Sky', '#79b8ff'], ['Mint', '#72d6ae'], ['Amber', '#efc06a'],
  ['Coral', '#ef9381'], ['Rose', '#e69abb'], ['Silver', '#e8e8ec']
] as const;
export function AppearanceSettings() {
  useLocale();
  const {layout,setLayout}=useLibraryLayout();
  const { value, loading, saving, error, saveError, save } = useAppearance();
  const [draft, setDraft] = useState<Appearance>(value), [saved, setSaved] = useState(false), [editingColor, setEditingColor] = useState(false);
  useEffect(() => { if (!saving && !saveError && !editingColor) setDraft(value); }, [value, saving, saveError, editingColor]);
  const valid = isAppearance(draft), changed = draft.controllerStyle !== value.controllerStyle || draft.accentColor.toLowerCase() !== value.accentColor;
  const update = (patch: Partial<Appearance>, commit = true) => {
    const next = { ...draft, ...patch };
    setSaved(false); setDraft(next);
    if (commit && isAppearance(next) && (saving || saveError || next.controllerStyle !== value.controllerStyle || next.accentColor.toLowerCase() !== value.accentColor)) void save(next).then(() => setSaved(true)).catch(() => {});
  };
  return <section id="settings-panel-appearance" className="settings-card settings-section" aria-labelledby="settings-title-appearance">
    <div className="settings-card-head"><div><h2 id="settings-title-appearance" tabIndex={-1}>{t("Appearance")}</h2><p>{t("Player controls and accent color.")}</p></div></div>
    {error && <p className="error-copy" role="alert">{t("Could not load appearance settings. Reload to try again.")}</p>}
    <LanguageSettings/>
    <div className="setting-row"><div className="setting-copy"><strong>{t('Library view')}</strong></div>
      <Select className="settings-picker" label={t('Library view')} value={layout} align="end" onChange={value=>setLayout(value as LibraryLayout)}
        options={[{value:'grid',label:t('Grid view')},{value:'explorer',label:t('Explorer view')}]}/>
    </div>
    <div className="appearance-form">
      <fieldset disabled={loading || Boolean(error)}>
        <legend>{t("Controller style")}</legend>
        <div className="appearance-styles" style={appearanceVariables(draft.accentColor) as CSSProperties}>
          {styles.map(style => <label className="appearance-style" key={style.value} data-selected={draft.controllerStyle === style.value}>
            <input type="radio" name="controller-style" value={style.value} checked={draft.controllerStyle === style.value} onChange={() => update({ controllerStyle: style.value })}/>
            <span className="appearance-mini" data-style={style.value} aria-hidden="true">
              <span className="appearance-mini-seek"/><span className="appearance-mini-transport"><i/><Play weight="fill"/><i/></span><span className="appearance-mini-tools"><i/><i/><i/></span>
            </span>
            <span className="appearance-style-label"><strong>{style.name}</strong>{draft.controllerStyle === style.value && <Check aria-hidden="true"/>}</span>
            <small>{t(style.description)}</small>
          </label>)}
        </div>
        <div className="appearance-color">
          <label htmlFor="appearance-color">{t("Accent color")}</label>
          <div className="appearance-color-fields">
            <input id="appearance-color" className="appearance-color-picker" type="color" value={valid ? draft.accentColor : value.accentColor} onFocus={() => setEditingColor(true)} onChange={event => update({ accentColor: event.currentTarget.value }, false)} onBlur={event => { setEditingColor(false); update({ accentColor: event.currentTarget.value }); }}/>
            <input className="input appearance-hex" type="text" aria-label={t("Accent color hex code")} aria-invalid={!valid} value={draft.accentColor} maxLength={7} spellCheck={false} autoComplete="off" onFocus={() => setEditingColor(true)} onChange={event => update({ accentColor: event.currentTarget.value }, false)} onBlur={() => { setEditingColor(false); if (valid) update({}); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}/>
            <div className="appearance-swatches" role="group" aria-label={t("Accent color presets")}>{colors.map(([name, color]) =>
              <button key={color} type="button" aria-label={t(name)} aria-pressed={draft.accentColor.toLowerCase() === color} style={{ '--swatch': color } as CSSProperties} onClick={() => update({ accentColor: color })}>{draft.accentColor.toLowerCase() === color && <Check aria-hidden="true"/>}</button>)}</div>
          </div>
          {!valid && <p className="error-copy">{t("Use a six-digit hex color, such as #79b8ff.")}</p>}
        </div>
      </fieldset>
      {saveError && <p className="error-copy" role="alert">{t(saveError.message)}</p>}
      <div className="appearance-actions">
        <Button type="button" variant="ghost" isDisabled={loading || Boolean(error)} onPress={() => update({ ...DEFAULT_APPEARANCE })}>{t("Reset to default")}</Button>
        {saveError && <Button variant="secondary" isDisabled={!valid || saving} onPress={() => update({})}>{t("Try again")}</Button>}
        <span role="status">{saving ? t("Saving…") : saved && !changed && !saveError ? t("Saved") : loading ? t("Loading…") : ''}</span></div>
    </div>
  </section>;
}
