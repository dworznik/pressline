import { HttpApi, HttpApiEndpoint, HttpApiGroup } from '@effect/platform'
import { Schema } from 'effect'
import {
  DesignId,
  DesignNotFound,
  DesignResponse,
  EngineHealth,
  PrintfileReady,
  PrintfileRejected,
  PrintfileRendering,
} from './protocol.js'
import { PrintfileSpec } from './spec.js'

/**
 * The DesignSource protocol as an Effect HttpApi (ADR-0003, ADR-0005).
 * Pressline derives its client from it; an Engine written with Effect can
 * implement it with `HttpApiBuilder`; any other Engine follows the paths and
 * schemas. Every request from Pressline carries `Authorization: Bearer <shared secret>`.
 */
const DesignPath = Schema.Struct({ designId: DesignId })

export const DesignsGroup = HttpApiGroup.make('designs')
  .add(
    HttpApiEndpoint.get('getDesign', '/designs/:designId')
      .setPath(DesignPath)
      .addSuccess(DesignResponse)
      .addError(DesignNotFound, { status: 404 }),
  )
  .add(
    HttpApiEndpoint.post('ensurePrintfile', '/designs/:designId/printfile')
      .setPath(DesignPath)
      .setPayload(PrintfileSpec)
      .addSuccess(PrintfileReady, { status: 200 })
      .addSuccess(PrintfileRendering, { status: 202 })
      .addError(DesignNotFound, { status: 404 })
      .addError(PrintfileRejected, { status: 422 }),
  )

export const HealthGroup = HttpApiGroup.make('health').add(
  HttpApiEndpoint.get('health', '/health').addSuccess(EngineHealth),
)

export class EngineApi extends HttpApi.make('engine').add(DesignsGroup).add(HealthGroup) {}
