// Plan, write, compile, measure, repair, review. The loop keeps the best model it has seen,
// so a design that compiled once is never lost to a later bad attempt.
import { measure, parseStl, type MeshMetrics } from '../cad/mesh';
import { BRIEF_SYSTEM, PLAN_SYSTEM, REVIEW_SYSTEM, SYSTEM, generatePrompt, planPrompt, repairPrompt, reviewPrompt } from './prompts';
import { failures, jsonIn, parseSpec, penalty, sizeText, verify, type Check, type Spec } from './spec';

export type Picture = { mime: string; data: string };
export type Completion = { system: string; prompt: string; images?: Picture[]; json?: boolean };
export type Compiled = { bytes: Uint8Array; log: string };

export type Tools = {
  complete(request: Completion): Promise<string>;
  compile(code: string): Promise<Compiled>;
  docs(prompt: string): Promise<string>;
  /** Renders the standard views of a mesh. Absent where nothing can draw them. */
  views?(stl: Uint8Array): Promise<Picture[]>;
  log(message: string): void;
  /** Shows work in progress in the editor and viewport. */
  progress?(design: Design): void;
};

export type DesignRequest = {
  prompt: string;
  code: string;
  image?: Picture;
  skills: string[];
  repairs: number;
  precise: boolean;
  vision: boolean;
};

export type Design = {
  code: string;
  stl: Uint8Array;
  log: string;
  metrics: MeshMetrics;
  checks: Check[];
  spec?: Spec;
};

/** Takes the longest fenced block, whatever its tag, since models often add prose around it. */
export function extractCode(text: string) {
  const clean = text.replace(/^﻿/, '').trim();
  const blocks = [...clean.matchAll(/```[^\n`]*\n([\s\S]*?)```/g)].map(match => match[1].trim());
  if (blocks.length) return blocks.reduce((best, block) => block.length > best.length ? block : best);
  return clean.replace(/^```[^\n`]*\n?/, '').replace(/```$/, '').trim();
}

export function measured(code: string, compiled: Compiled, spec?: Spec | null): Design {
  const metrics = measure(parseStl(compiled.bytes));
  return { code, stl: compiled.bytes, log: compiled.log, metrics, checks: verify(metrics, code, compiled.log, spec), spec: spec ?? undefined };
}

async function plan(request: DesignRequest, tools: Tools) {
  tools.log('Planning dimensions and features…');
  try {
    const reply = await tools.complete({
      system: PLAN_SYSTEM,
      prompt: planPrompt(request.prompt, request.code, request.skills),
      images: request.image ? [request.image] : [],
      json: true,
    });
    const spec = parseSpec(reply);
    if (!spec) tools.log('The plan could not be read, so the design continues without one.');
    return spec;
  } catch (error) {
    if (isAbort(error)) throw error;
    tools.log(`Planning failed, so the design continues without a plan: ${error}`);
    return null;
  }
}

async function review(request: DesignRequest, design: Design, tools: Tools): Promise<string[]> {
  if (!tools.views) return [];
  try {
    tools.log('Reviewing rendered views against the request…');
    const images = await tools.views(design.stl);
    if (request.image) images.push(request.image);
    const reply = await tools.complete({
      system: REVIEW_SYSTEM,
      prompt: reviewPrompt(request.prompt, sizeText(design.metrics.size), Boolean(request.image)),
      images,
      json: true,
    });
    const verdict = jsonIn(reply) as { matches?: boolean; problems?: unknown } | null;
    if (!verdict || verdict.matches === true || !Array.isArray(verdict.problems)) return [];
    return verdict.problems.filter((item): item is string => typeof item === 'string').slice(0, 6);
  } catch (error) {
    if (isAbort(error)) throw error;
    tools.log('This model could not review images, so that step was skipped.');
    return [];
  }
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function design(request: DesignRequest, tools: Tools): Promise<Design> {
  const docs = await tools.docs(request.prompt).catch(() => '');
  const spec = request.precise ? await plan(request, tools) : null;
  if (spec?.summary) tools.log(`Plan: ${spec.summary}`);
  for (const item of spec?.assumptions ?? []) tools.log(`Assumption: ${item}`);
  const planText = spec ? JSON.stringify(spec, null, 1) : undefined;

  tools.log('Writing OpenSCAD…');
  let code = extractCode(await tools.complete({
    system: SYSTEM,
    prompt: generatePrompt(request.prompt, request.code, request.skills, docs, planText),
    images: request.image ? [request.image] : [],
  }));

  let best: Design | undefined;
  let lastError = '';
  let reviewed = !(request.precise && request.vision);
  for (let attempt = 0; ; attempt++) {
    let problems: string[];
    tools.log(attempt ? `Compiling repair ${attempt}…` : 'Compiling and measuring…');
    try {
      const current = measured(code, await tools.compile(code), spec);
      tools.log(`Measured ${sizeText(current.metrics.size)}, ${current.metrics.bodies} bod${current.metrics.bodies === 1 ? 'y' : 'ies'}, ${current.metrics.throughHoles} through holes.`);
      if (!best || penalty(current.checks) <= penalty(best.checks)) {
        best = current;
        tools.progress?.(current);
      }
      problems = request.precise ? failures(current.checks) : [];
      if (!problems.length && !reviewed && attempt < request.repairs) {
        reviewed = true;
        problems = await review(request, current, tools);
      }
    } catch (error) {
      if (isAbort(error)) throw error;
      lastError = String(error instanceof Error ? error.message : error);
      problems = [`OpenSCAD could not compile the code:\n${lastError.slice(0, 2000)}`];
    }
    if (!problems.length) break;
    if (attempt >= request.repairs) {
      tools.log(`Stopping after ${attempt} repair${attempt === 1 ? '' : 's'}. ${problems.length} problem${problems.length === 1 ? '' : 's'} remain.`);
      break;
    }
    for (const problem of problems) tools.log(`Fixing: ${problem.split('\n')[0]}`);
    try {
      code = extractCode(await tools.complete({ system: SYSTEM, prompt: repairPrompt(request.prompt, code, problems, planText) }));
    } catch (error) {
      if (isAbort(error) || !best) throw error;
      tools.log(`The repair request failed, so the best design so far is kept: ${error}`);
      break;
    }
  }
  if (!best) throw new Error(`No attempt compiled.\n${lastError}`);
  return best;
}

export function imageBrief(image: Picture, tools: Pick<Tools, 'complete'>) {
  return tools.complete({ system: BRIEF_SYSTEM, prompt: 'Describe this object as a design brief.', images: [image] });
}
