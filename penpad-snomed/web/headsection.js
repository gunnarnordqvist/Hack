// Cross-section of the head and neck (a cut down the middle, face to the left) for the body map close-up.
// Drawn for this project from scratch: simple shapes, not traced from any atlas, app or other drawing. Regions are SNOMED CT body
// structures (see backend/topics.json); which findings belong to a region is decided by the terminology, not by the drawing.

export const HEAD_SECTION = {
  box: "0 0 470 440",
  fontScale: 0.036,
  outline: [
    "M 128 150 C 124 80 190 28 262 38 C 335 50 362 130 344 205 C 336 245 328 285 322 335 L 332 432 L 188 432 L 192 352 C 160 350 128 344 124 322 C 112 318 110 305 114 295 C 106 290 106 270 112 262 C 104 256 108 240 116 238 C 104 238 88 232 86 224 C 90 214 108 200 120 190 C 126 176 128 166 128 150 Z",
  ],
  // drawn from back to front
  shapes: [
    { region: "head", side: null, paths: ["M 140 140 C 144 84 196 48 258 56 C 318 66 336 130 322 192 C 314 218 276 226 240 214 C 196 204 150 196 140 140 Z"] },
    { region: "nose", side: null, paths: ["M 124 196 C 108 204 94 214 92 224 C 104 232 120 236 142 234 L 196 232 C 186 216 156 204 124 196 Z"] },
    { region: "mouth", side: null, paths: ["M 118 252 L 208 250 C 214 262 210 276 194 284 L 126 284 C 114 278 112 262 118 252 Z"] },
    { region: "teeth", side: null, paths: ["M 114 244 L 130 244 C 132 254 131 262 128 268 L 116 268 Z", "M 114 272 L 130 272 C 132 282 131 290 128 298 L 114 296 Z"] },
    { region: "tongue", side: null, paths: ["M 134 282 C 160 262 204 262 232 288 C 250 304 238 324 206 326 C 168 330 138 320 134 300 Z"] },
    { region: "throat", side: null, paths: ["M 226 262 C 248 258 268 268 270 300 L 268 346 C 252 354 230 348 224 334 C 234 312 230 288 226 262 Z"] },
    { region: "larynx", side: null, paths: ["M 228 350 L 268 350 L 272 398 L 232 400 Z"] },
  ],
  anchors: {
    head: [236, 128], tongue: [186, 306], nose: [40, 206], mouth: [40, 252], teeth: [40, 290], throat: [400, 300], larynx: [400, 376],
  },
  // thin lines from a label to its part: [x1, y1, x2, y2]
  leaders: {
    nose: [66, 210, 100, 222], mouth: [64, 252, 114, 258], teeth: [62, 288, 114, 284], throat: [372, 300, 262, 300], larynx: [372, 376, 270, 376],
  },
};
