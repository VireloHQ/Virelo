import { useEffect, useState, type CSSProperties } from 'react';
import { Button } from '@heroui/react';
import { Check, Play } from '@phosphor-icons/react';
import { useAppearance } from './AppearanceProvider';
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
  const { value, loading, saving, error, saveError, save } = useAppearance();
  const [draft, setDraft] = useState<Appearance>(value), [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(value); }, [value]);
  const valid = isAppearance(draft), changed = draft.controllerStyle !== value.controllerStyle || draft.accentColor.toLowerCase() !== value.accentColor;
  const update = (patch: Partial<Appearance>) => { setSaved(false); setDraft(current => ({ ...current, ...patch })); };
  return <section id="settings-panel-appearance" className="settings-card settings-section" aria-labelledby="settings-title-appearance">
    <div className="settings-card-head"><div><h2 id="settings-title-appearance" tabIndex={-1}>Appearance</h2><p>Player controls and accent color.</p></div></div>
    {error && <p className="error-copy" role="alert">Could not load appearance settings. Reload to try again.</p>}
    <form className="appearance-form" onSubmit={event => { event.preventDefault(); if (valid) void save(draft).then(() => setSaved(true)).catch(() => {}); }}>
      <fieldset disabled={loading || saving || Boolean(error)}>
        <legend>Controller style</legend>
        <div className="appearance-styles" style={appearanceVariables(draft.accentColor) as CSSProperties}>
          {styles.map(style => <label className="appearance-style" key={style.value} data-selected={draft.controllerStyle === style.value}>
            <input type="radio" name="controller-style" value={style.value} checked={draft.controllerStyle === style.value} onChange={() => update({ controllerStyle: style.value })}/>
            <span className="appearance-mini" data-style={style.value} aria-hidden="true">
              <span className="appearance-mini-seek"/><span className="appearance-mini-transport"><i/><Play weight="fill"/><i/></span><span className="appearance-mini-tools"><i/><i/><i/></span>
            </span>
            <span className="appearance-style-label"><strong>{style.name}</strong>{draft.controllerStyle === style.value && <Check aria-hidden="true"/>}</span>
            <small>{style.description}</small>
          </label>)}
        </div>
        <div className="appearance-color">
          <label htmlFor="appearance-color">Accent color</label>
          <div className="appearance-color-fields">
            <input id="appearance-color" className="appearance-color-picker" type="color" value={valid ? draft.accentColor : value.accentColor} onChange={event => update({ accentColor: event.currentTarget.value })}/>
            <input className="input appearance-hex" type="text" aria-label="Accent color hex code" aria-invalid={!valid} value={draft.accentColor} maxLength={7} spellCheck={false} autoComplete="off" onChange={event => update({ accentColor: event.currentTarget.value })}/>
            <div className="appearance-swatches" role="group" aria-label="Accent color presets">{colors.map(([name, color]) =>
              <button key={color} type="button" aria-label={name} aria-pressed={draft.accentColor.toLowerCase() === color} style={{ '--swatch': color } as CSSProperties} onClick={() => update({ accentColor: color })}>{draft.accentColor.toLowerCase() === color && <Check aria-hidden="true"/>}</button>)}</div>
          </div>
          {!valid && <p className="error-copy">Use a six-digit hex color, such as #79b8ff.</p>}
        </div>
      </fieldset>
      {saveError && <p className="error-copy" role="alert">{saveError.message}</p>}
      <div className="appearance-actions"><Button type="submit" isPending={saving} isDisabled={!valid || !changed || loading || Boolean(error)}>Save appearance</Button>
        <Button type="button" variant="ghost" isDisabled={loading || saving || Boolean(error)} onPress={() => update({ ...DEFAULT_APPEARANCE })}>Reset to default</Button>
        <span role="status">{saved && !changed ? 'Saved' : loading ? 'Loading…' : ''}</span></div>
    </form>
  </section>;
}
