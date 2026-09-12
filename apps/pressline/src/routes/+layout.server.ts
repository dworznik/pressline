import { getBranding } from '$lib/server/branding'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = () => ({ branding: getBranding() })
