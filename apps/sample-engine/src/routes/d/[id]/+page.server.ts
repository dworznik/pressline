import { error } from '@sveltejs/kit'
import { loadDesign } from '$lib/server/designs'
import { getRuntime } from '$lib/server/runtime'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ params, platform }) => {
  const { engine, settings } = await getRuntime(platform)
  const design = await loadDesign(engine.store, params.id)
  if (!design) error(404, 'No such design.')
  return {
    design: {
      id: design.id,
      title: design.title,
      previewUrl: design.previewUrl,
      printfiles: Object.keys(design.printfiles).length,
      offers: design.offers ?? null,
    },
    orderUrl: settings.presslineUrl
      ? `${settings.presslineUrl}/order/${settings.engineSlug}/${design.id}`
      : null,
  }
}
