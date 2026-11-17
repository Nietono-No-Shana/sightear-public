import type { Gate, SkillId, StageId } from '../ports';
import { SKILLS } from './skills';

export interface StageSpec {
  readonly id: StageId;
  readonly label: string;
  readonly gate: Gate;
  readonly skills: readonly SkillId[];
}

function skillsFor(stage: StageId): readonly SkillId[] {
  return SKILLS.filter((skill) => skill.stage === stage).map((skill) => skill.id);
}

/** M1 只填充 S1 的 interval/chord identify；S2–S5 的技能表留给后续 milestone。 */
export const STAGES: readonly StageSpec[] = [
  {
    id: 'S1',
    label: '纵向基础与记谱起步',
    gate: { accuracy: 0.9, medianRtMs: 1_500, production: 0.8, retention: 0.85, minAttempts: 20 },
    skills: skillsFor('S1'),
  },
  {
    id: 'S2',
    label: '和声功能',
    gate: { accuracy: 0.85, medianRtMs: 2_000, production: 0.8, retention: 0.85, minAttempts: 20 },
    skills: skillsFor('S2'),
  },
  {
    id: 'S3',
    label: '声部进行与转调',
    gate: { accuracy: 0.8, medianRtMs: 2_000, production: 0.7, retention: 0.85, minAttempts: 20 },
    skills: skillsFor('S3'),
  },
  {
    id: 'S4',
    label: '织体与配器',
    gate: { accuracy: 0.8, medianRtMs: 2_000, production: 0.8, retention: 0.85, minAttempts: 20 },
    skills: skillsFor('S4'),
  },
  {
    id: 'S5',
    label: '综合转写',
    gate: { accuracy: 0.75, medianRtMs: 2_000, production: 0.7, retention: 0.85, minAttempts: 20 },
    skills: skillsFor('S5'),
  },
];

export function getStage(id: StageId): StageSpec {
  const stage = STAGES.find((candidate) => candidate.id === id);
  if (stage === undefined) {
    throw new RangeError(`unknown stage ${id}`);
  }
  return stage;
}

export function stageOf(skill: SkillId): StageSpec {
  const stage = STAGES.find((candidate) => candidate.skills.includes(skill));
  if (stage === undefined) {
    throw new RangeError(`skill ${skill} is not assigned to a stage`);
  }
  return stage;
}

export function gateOf(stage: StageId): Gate {
  return getStage(stage).gate;
}
