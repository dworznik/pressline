import { fail, redirect } from '@sveltejs/kit';
import { finalise } from '$lib/server/designs';
import { openAiAdapter } from '$lib/server/ai/openai';
import { getRuntime } from '$lib/server/runtime';
import { defaultTemplate, sanitise } from '$lib/template';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
  const { settings } = await getRuntime(platform);
  return {
    template: defaultTemplate,
    ai: !!settings.openAiKey,
    pressline: settings.presslineUrl ?? null,
  };
};

export const actions: Actions = {
  /** Finalise the template: store the Design, pre-render, and go to its page. */
  finalise: async ({ request, platform }) => {
    const form = await request.formData();
    const template = sanitise({
      text: String(form.get('text') ?? ''),
      textColor: String(form.get('textColor') ?? ''),
      background: String(form.get('background') ?? ''),
      shape: String(form.get('shape') ?? '') as never,
      shapeColor: String(form.get('shapeColor') ?? ''),
    });
    const { engine } = await getRuntime(platform);
    const design = await finalise(engine, { template });
    redirect(303, `/d/${design.id}`);
  },
  /** The AI path: a prompt becomes raster input for the same render path. */
  generate: async ({ request, platform }) => {
    const { engine, settings } = await getRuntime(platform);
    if (!settings.openAiKey)
      return fail(400, { message: 'AI generation is not enabled on this Engine.' });
    const prompt = String((await request.formData()).get('prompt') ?? '').slice(0, 500);
    if (!prompt) return fail(400, { message: 'Describe the image first.' });
    const image = await openAiAdapter(settings.openAiKey)
      .generate(prompt)
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }));
    if ('error' in image) return fail(502, { message: `Could not generate: ${image.error}` });
    const design = await finalise(engine, { raster: image.bytes, title: prompt.slice(0, 40) });
    redirect(303, `/d/${design.id}`);
  },
};
