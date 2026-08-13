# Pickup Rabbit PoseClip Prompts

Built-in imagegen was used with the existing `farmer/bend.png`, `farmer/pickup.png`, `farmer/hold-rabbit.png`, and `rabbit/lying.png` as identity/style references.

The four prompts preserve the same farmer and rabbit while advancing one semantic change per frame:

1. `pickup-rabbit-01`: deeply bent; both hands make contact while the rabbit remains on the ground.
2. `pickup-rabbit-02`: rabbit clearly leaves the ground and is supported at lower-shin height.
3. `pickup-rabbit-03`: farmer is halfway upright; rabbit reaches waist height.
4. `pickup-rabbit-04`: farmer is nearly upright; rabbit reaches chest height and transitions into `hold-rabbit`.

All prompts require one complete composite sprite, the original watercolor paper-cut identity, full-body framing, and a flat `#ff00ff` chroma background with no scenery, props, shadows, extra limbs, text, or watermark. The final PNGs were produced with the imagegen skill's `remove_chroma_key.py` helper using border auto-key, soft matte, and despill.
