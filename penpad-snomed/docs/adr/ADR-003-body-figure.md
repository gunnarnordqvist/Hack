# ADR-003: MIT-licensed body figure with unverified artwork origin
Status: accepted with a caveat; needs a human to decide whether the risk is acceptable.
**Context.** A body map is needed; hand-drawing was rejected as poor, and copyrighted material is not allowed.
**Decision.** Use path data from npm `react-body-map` 1.1.0 (MIT), chain react-native-body-highlighter → react-body-highlighter. Paths are read as text by `tools/build_body_paths.py`, not executed. Notices in THIRD_PARTY_NOTICES.md.
**Consequences.** The licence chain is MIT throughout, but the origin of the original artwork could not be verified. Replace the figure if the owner is not comfortable with that.
