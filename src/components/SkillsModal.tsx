import { useState } from 'react';
import { X, Check, Plus, Trash2, BookCheck, ShieldCheck } from 'lucide-react';
import type { Skill } from '../hooks/useSkills';

type Props = {
  skills: Skill[];
  onClose: () => void;
  onToggle: (id: string) => void;
  onAdd: (title: string, desc: string, prompt: string) => void;
  onDelete: (id: string) => void;
};

export default function SkillsModal({ skills, onClose, onToggle, onAdd, onDelete }: Props) {
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrompt, setNewPrompt] = useState('');

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newPrompt.trim()) return;
    onAdd(newTitle, newDesc, newPrompt);
    setNewTitle('');
    setNewDesc('');
    setNewPrompt('');
    setAdding(false);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: '640px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-heading">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BookCheck size={20} color="var(--accent)" />
            <h2>Design Skills & Rules</h2>
          </div>
          <button title="Close" onClick={onClose}><X size={16} /></button>
        </div>

        <p style={{ margin: '8px 0 16px' }}>
          Manage the CAD constraints that the model should follow during generation and repair.
          Enabled rules are added automatically to every design request.
        </p>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 8px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.8px' }}>
            SAVED SKILLS ({skills.filter(s => s.enabled).length} / {skills.length} ACTIVE)
          </span>
          {!adding && (
            <button
              style={{ fontSize: '11px', padding: '5px 9px', background: 'var(--sub)' }}
              onClick={() => setAdding(true)}
            >
              <Plus size={13} /> Add new rule
            </button>
          )}
        </div>

        {adding && (
          <form onSubmit={handleSave} style={{ background: 'var(--sub)', padding: '14px', borderRadius: '8px', border: '1px solid var(--accent)', margin: '10px 0 16px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--accent)', marginBottom: '8px' }}>
              Define a design rule or skill
            </div>
            <label style={{ display: 'block', fontSize: '11px', margin: '6px 0' }}>
              Title (for example, “Thin wall reinforcement” or “M4 clearance”)
              <input
                required
                placeholder="Rule title"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                style={{ marginTop: '4px', padding: '8px' }}
              />
            </label>
            <label style={{ display: 'block', fontSize: '11px', margin: '6px 0' }}>
              Short description (optional)
              <input
                placeholder="Purpose or context for this rule"
                value={newDesc}
                onChange={e => setNewDesc(e.target.value)}
                style={{ marginTop: '4px', padding: '8px' }}
              />
            </label>
            <label style={{ display: 'block', fontSize: '11px', margin: '6px 0' }}>
              Exact instruction sent to the model
              <textarea
                required
                rows={3}
                placeholder="Example: - Keep walls at least 1.5 mm thick.\n- Add four 4.2 mm mounting holes to the base."
                value={newPrompt}
                onChange={e => setNewPrompt(e.target.value)}
                style={{ marginTop: '4px', padding: '8px', minHeight: '80px' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
              <button type="button" onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" className="primary" style={{ padding: '6px 14px' }}>
                <Check size={14} /> Save
              </button>
            </div>
          </form>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '340px', overflowY: 'auto', paddingRight: '4px' }}>
          {skills.map(skill => (
            <div
              key={skill.id}
              style={{
                background: skill.enabled ? 'var(--sub)' : 'var(--bg)',
                border: skill.enabled ? '1px solid var(--accent)' : '1px solid var(--border)',
                borderRadius: '8px',
                padding: '12px 14px',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                type="checkbox"
                aria-label={skill.title}
                checked={skill.enabled}
                onChange={() => onToggle(skill.id)}
                style={{ width: '16px', height: '16px', marginTop: '3px', accentColor: 'var(--accent)', cursor: 'pointer' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 600, fontSize: '12px', color: skill.enabled ? 'var(--text)' : 'var(--muted)' }}>
                    {skill.title}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {skill.isDefault && (
                      <span style={{ fontSize: '9px', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <ShieldCheck size={11} /> Built in
                      </span>
                    )}
                    {!skill.isDefault && (
                      <button
                        title="Delete rule"
                        style={{ border: 'none', padding: '3px', color: 'var(--muted)', cursor: 'pointer' }}
                        onClick={() => onDelete(skill.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
                {skill.description && (
                  <p style={{ fontSize: '10px', color: 'var(--muted)', margin: '2px 0 6px' }}>
                    {skill.description}
                  </p>
                )}
                <div style={{ fontSize: '11px', fontFamily: 'Consolas, monospace', background: 'var(--input)', padding: '6px 8px', borderRadius: '4px', color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: '1.4' }}>
                  {skill.prompt}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="modal-actions" style={{ marginTop: '18px' }}>
          <span style={{ fontSize: '10px', color: 'var(--muted)', alignSelf: 'center' }}>
            Selected rules are automatically included with every design request.
          </span>
          <button className="primary" onClick={onClose} style={{ padding: '8px 18px' }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
