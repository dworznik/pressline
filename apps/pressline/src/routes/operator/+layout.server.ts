import { isDemo } from '$lib/server/runtime'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = () => ({ demo: isDemo() })
