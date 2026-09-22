import { Box, Settings, Sun, Moon, PanelLeftClose, PanelLeft, BookCheck } from 'lucide-react';
import type { Theme } from '../hooks/useTauriCommands';

type Props = {
  theme: Theme;
  status: string;
  available: boolean;
  disabled: boolean;
  sidebarOpen: boolean;
  activeSkillsCount: number;
  onTheme: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
  onOpenSkills: () => void;
};

export default function Header(p: Props) {
  return (
    <header>
      <div className="brand">
        <button
          type="button"
          title={p.sidebarOpen ? 'Hide assistant panel' : 'Show assistant panel'}
          onClick={p.onToggleSidebar}
          style={{ padding: '6px 8px', border: '1px solid var(--border)', background: 'var(--sub)' }}
        >
          {p.sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
        <div className="brand-icon">
          <Box size={24} />
        </div>
        <strong>OpenSCAD <em>AI</em></strong>
        <span className="edition">DESIGN WORKSHOP / 02</span>
      </div>
      <div className="header-actions">
        <button
          type="button"
          title="Design rules and skills"
          onClick={p.onOpenSkills}
          disabled={p.disabled}
          style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}
        >
          <BookCheck size={16} color="var(--accent)" />
          <span>Rules ({p.activeSkillsCount})</span>
        </button>
        <span className={`status ${p.available ? '' : 'unavailable'}`}>
          <i />
          {p.status}
        </span>
        <button disabled={p.disabled} title="Cycle theme" onClick={p.onTheme}>
          {p.theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}
          <span>{p.theme}</span>
        </button>
        <button disabled={p.disabled} onClick={p.onSettings}>
          <Settings size={17} />
          Settings
        </button>
      </div>
    </header>
  );
}
