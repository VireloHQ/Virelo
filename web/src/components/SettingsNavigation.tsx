import { CaretRight } from '@phosphor-icons/react';

interface SettingsSection {
  id: string;
  label: string;
  description: string;
}

export function SettingsNavigation({ sections, activeSection, onSelect }: {
  sections: readonly SettingsSection[];
  activeSection: string;
  onSelect: (id: string) => void;
}) {
  return <nav className="settings-sidebar" aria-label="Settings sections">
    {sections.map((section) => <button
      key={section.id}
      id={`settings-nav-${section.id}`}
      type="button"
      aria-label={section.label}
      className={`settings-nav-item${activeSection === section.id ? ' active' : ''}`}
      aria-current={activeSection === section.id ? 'page' : undefined}
      aria-controls={activeSection === section.id ? `settings-panel-${section.id}` : undefined}
      onClick={() => onSelect(section.id)}
    >
      <span className="settings-nav-copy"><strong>{section.label}</strong><small>{section.description}</small></span>
      <CaretRight className="settings-nav-chevron" aria-hidden="true"/>
    </button>)}
  </nav>;
}

