---
title: AI-assisted Engines
description: A generated image is raster input like any other.
---

An AI Engine differs from a template Engine only in where the pixels come from. Keep the model behind a small interface (the sample's `AiAdapter`: `generate(prompt) → { bytes, contentType }`), store the raw result under the Design, and feed it to the same `render()` path per Spec. Practical points:

- Ask the model for the design's aspect (portrait for tees and posters) and the largest size it offers; upscaling a small image to a 4500×5400 DTG file shows.
- Set `sellable: false` until moderation or the user's confirmation has run; Pressline will not sell it.
- Keep prompts and raw outputs private; only the Preview and Printfiles are public URLs.
- Generation is slow: answer 202 to the printfile request if you render on demand, or pre-render on finalise.
- The sample Engine enables an OpenAI adapter when `OPENAI_API_KEY` is set; without a key it is a plain template designer.
