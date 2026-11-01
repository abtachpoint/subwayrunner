# Licensed/source assets for Subway Runner

All assets were supplied by the project owner. The Kenney CC0 kits are baked into `web/assets/kenney_models.js` and all 184 meshes are included in the runtime. Quaternius robot + farm animals are baked into `web/assets/quaternius_props.js` and shown in roadside scenes.

The selected Quaternius humanoid GLTFs and Universal Animation Library GLBs were baked into `web/assets/skinned_characters.js` with `tools/generate_skinned_characters.py`. **Human playable runners now use actual 65-joint skinning and 12 sampled action clips** through `web/skinned_player.js`, with CPU deformation and WebGL dynamic mesh buffers. Original **Fox Fenn and Robot** still use the existing procedural animated rigs (their FBX animation channels were not ported). Quaternius farm animals and one robot from the donated packs remain roadside decorative meshes, not new playable rigs.

Individual asset-license files are preserved beside each original collection. Original complete contributor ZIPs remain in the owner's uploads and are intentionally not embedded twice, preventing excessive GitHub repository size.
