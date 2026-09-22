import { useState, useEffect, useCallback } from 'react';

export type Skill = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  enabled: boolean;
  isDefault?: boolean;
};

const DEFAULT_SKILLS: Skill[] = [
  {
    id: '3d-print-tolerance',
    title: '3D Print Tolerances',
    description: 'Minimum wall thickness and stable-base rules for FDM/SLA printing',
    prompt: '- Keep walls and shells at least 2.0 mm thick.\n- Include at least one wide, flat surface for stable bed adhesion.\n- Avoid unsupported overhangs steeper than 45 degrees.',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'hardware-m3',
    title: 'M3 Bolt & Nut Pockets',
    description: 'Practical clearances for M3 through-holes and hex nut pockets',
    prompt: '- Use a 3.2 mm diameter for M3 clearance holes.\n- Use a 5.7 mm flat-to-flat width and 2.6 mm depth for M3 hex nut pockets.',
    enabled: false,
    isDefault: true,
  },
  {
    id: 'smooth-fillets',
    title: 'Smooth Transitions',
    description: 'Round sharp edges for better ergonomics and durability',
    prompt: '- Apply at least a 2 mm fillet, chamfer, or hull() transition to exposed outer edges.\n- Add radii to sharp internal corners to reduce stress concentration.',
    enabled: false,
    isDefault: true,
  },
  {
    id: 'clean-parameters',
    title: 'Documented Parameters',
    description: 'Expose dimensions at the top of the file with editable ranges',
    prompt: '- Define every important dimension at the top of the file with // [min:step:max] range comments in the same language as the user prompt.\n- Keep the preview $fn value between 32 and 64.',
    enabled: true,
    isDefault: true,
  },
];

const STORAGE_KEY = 'openscad-ai-skills';

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return DEFAULT_SKILLS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(skills));
    } catch {}
  }, [skills]);

  const toggleSkill = useCallback((id: string) => {
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  }, []);

  const addSkill = useCallback((title: string, description: string, prompt: string) => {
    const newSkill: Skill = {
      id: 'skill-' + Date.now(),
      title: title.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      enabled: true,
    };
    setSkills(prev => [...prev, newSkill]);
  }, []);

  const deleteSkill = useCallback((id: string) => {
    setSkills(prev => prev.filter(s => s.id !== id));
  }, []);

  const activeSkillPrompts = skills
    .filter(s => s.enabled)
    .map(s => `[${s.title}]: ${s.prompt}`);

  return {
    skills,
    activeSkills: skills.filter(s => s.enabled),
    activeSkillPrompts,
    toggleSkill,
    addSkill,
    deleteSkill,
  };
}
