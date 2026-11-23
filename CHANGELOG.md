# Changelog

## [0.4.6](https://github.com/eikrad/bandsearch-app/compare/v0.4.5...v0.4.6) (2026-11-23)


### Features

* answer follow-ups without a new search ([eb4404c](https://github.com/eikrad/bandsearch-app/commit/eb4404cf4527696d0516150c34809c22039d6954)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** answer from Last.fm first when it knows enough ([b1401f7](https://github.com/eikrad/bandsearch-app/commit/b1401f7aa65d304b416c09b182fa1ac0553e3539)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** define each obscurity target as a listener range ([47e173e](https://github.com/eikrad/bandsearch-app/commit/47e173e14491fbd75fc5426a002a3114fa615add)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **api:** filter candidates to the obscurity target's range, floor included ([e94eb96](https://github.com/eikrad/bandsearch-app/commit/e94eb964bf4951c0bb33bfabffab0e021eea3349)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **api:** keep near misses of the obscurity range for the ranker ([7a6b594](https://github.com/eikrad/bandsearch-app/commit/7a6b5947052f8746b846fcd814a503f64481e830)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **api:** list recommendation feedback from the admin CLI ([8bfccef](https://github.com/eikrad/bandsearch-app/commit/8bfccef9a92d0898753d98a32d9a07fce095a288)), closes [#307](https://github.com/eikrad/bandsearch-app/issues/307) [#306](https://github.com/eikrad/bandsearch-app/issues/306)
* **api:** log where candidates fall against the target range around the obscurity filter ([698ccb0](https://github.com/eikrad/bandsearch-app/commit/698ccb02f2f6b582f4ca4e63b7faf28204aec110)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **api:** plan searches for the obscurity target's listener range ([f8ab192](https://github.com/eikrad/bandsearch-app/commit/f8ab192a918b8b3b5e04cd6316368139031da856)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **api:** rank by the obscurity target's listener range ([575cac9](https://github.com/eikrad/bandsearch-app/commit/575cac9bf6e629cdaef3742c23bb98fdab9d6a9a)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **api:** search for the obscurity target's listener range, floor included ([7ad4268](https://github.com/eikrad/bandsearch-app/commit/7ad4268133a0eced7475f911d6109081d42d4337))
* **api:** show the ranker each band's country ([f2fa0f8](https://github.com/eikrad/bandsearch-app/commit/f2fa0f822234d054c34ee9f5fae1a732be94694e)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336) [#257](https://github.com/eikrad/bandsearch-app/issues/257)
* **api:** store recommendation feedback in the main database ([dd91c3e](https://github.com/eikrad/bandsearch-app/commit/dd91c3eca4acc7dc6f80daf5e0fa6a47d1ca5bdf)), closes [#307](https://github.com/eikrad/bandsearch-app/issues/307) [#306](https://github.com/eikrad/bandsearch-app/issues/306)
* **api:** take candidates from Last.fm's similar artists too ([b51cc5f](https://github.com/eikrad/bandsearch-app/commit/b51cc5f8f229110c039d67c0c7cc5e7b325baaa9)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** use Last.fm biographies and tags as evidence ([3f3faee](https://github.com/eikrad/bandsearch-app/commit/3f3faeeffb83b77ea5bb8439ea357ba20b42b136)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336) [#257](https://github.com/eikrad/bandsearch-app/issues/257)
* **desktop:** wake a hosted API before the user's message needs it ([61f4c0c](https://github.com/eikrad/bandsearch-app/commit/61f4c0c6f2cdd506eacd573e73554d61d6f657d3)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **eval:** judge obscurity fit in both directions ([861b786](https://github.com/eikrad/bandsearch-app/commit/861b78698b5ad83ca479d8546b0b695afe4b95f7)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **eval:** measure how many picks land in the requested listener range ([1e9ea69](https://github.com/eikrad/bandsearch-app/commit/1e9ea6971a058436c9c839363619ad88ddbf251c)), closes [#325](https://github.com/eikrad/bandsearch-app/issues/325)
* **eval:** measure obscurity target misses in both directions ([143f4e9](https://github.com/eikrad/bandsearch-app/commit/143f4e9cdb30f7635a7b8c01692ac68a36630e34))
* **privacy:** disclose recommendation feedback and record ADR 0006 ([9108034](https://github.com/eikrad/bandsearch-app/commit/9108034029d6feae66db18bf5537a29e75f185ac)), closes [#307](https://github.com/eikrad/bandsearch-app/issues/307) [#306](https://github.com/eikrad/bandsearch-app/issues/306)
* stream progress and the reply while an answer is made ([8848881](https://github.com/eikrad/bandsearch-app/commit/884888112706e5f20ad93613496abf805616f3cc)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)


### Bug Fixes

* **api:** assemble account repositories on one storage backend ([6192e08](https://github.com/eikrad/bandsearch-app/commit/6192e08513715d4c019773d7108a4e3c2aad3b1b))
* **api:** enforce research deadline through final ranking ([52ea848](https://github.com/eikrad/bandsearch-app/commit/52ea848e5a2c9514cd955c61c1b9abf95e466d64))
* **api:** enforce the complete research deadline ([765273b](https://github.com/eikrad/bandsearch-app/commit/765273baee3c652a5e32a8400d70d5954fb10fcb))
* **api:** include authenticated feedback in account data ([626cae2](https://github.com/eikrad/bandsearch-app/commit/626cae2659ade8715fe1a19e124caef41a315e89))
* **api:** include authenticated recommendation feedback in account data ([ce71fb6](https://github.com/eikrad/bandsearch-app/commit/ce71fb67715f2dd0ef4d05db68bdbca87ce423ed))
* **api:** keep account repositories on the selected storage backend ([7c3ab2c](https://github.com/eikrad/bandsearch-app/commit/7c3ab2c23fd05d12e8dcc1bef7423a4987588f7d))
* **api:** search the web for what similarity cannot show ([31f873f](https://github.com/eikrad/bandsearch-app/commit/31f873f003ef8e98d5402c5ef54a482ec2c945b0)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **deps:** update tauri-plugin-updater to 2.14.1 and tauri to 2.12.7 ([463ad66](https://github.com/eikrad/bandsearch-app/commit/463ad665fc9d8a35382da34d3eccaa19d86527a8))
* **desktop:** grant every app command a permission ([d4b8511](https://github.com/eikrad/bandsearch-app/commit/d4b8511f8eae1a2c4aecc36ce5a467d536a2a002))
* **desktop:** grant every app command a permission ([8246914](https://github.com/eikrad/bandsearch-app/commit/8246914a82a38e598858b167557e16e705c76687)), closes [#330](https://github.com/eikrad/bandsearch-app/issues/330)
* **desktop:** keep save and rating errors up for the error timeout ([fa0cef5](https://github.com/eikrad/bandsearch-app/commit/fa0cef56a2ce22b577566da465ffc77c436601e0)), closes [#311](https://github.com/eikrad/bandsearch-app/issues/311)
* **desktop:** repaint the chat when a status message clears ([6720040](https://github.com/eikrad/bandsearch-app/commit/6720040b8dd3ba133d2236ed5ee458f86c8826a1)), closes [#311](https://github.com/eikrad/bandsearch-app/issues/311)
* **desktop:** report every Saved Artists outcome in a status line ([4897a56](https://github.com/eikrad/bandsearch-app/commit/4897a5604df0b7b1146d548b25dfd9fa226c33ca)), closes [#313](https://github.com/eikrad/bandsearch-app/issues/313)
* **desktop:** route every way into the app through one session ([eecf2eb](https://github.com/eikrad/bandsearch-app/commit/eecf2eb7ef877ab007dd1a8d08bb252d30a86df2)), closes [#313](https://github.com/eikrad/bandsearch-app/issues/313)
* **desktop:** say the AI model is hosted in the EU, not only who hosts it ([9bf0490](https://github.com/eikrad/bandsearch-app/commit/9bf0490668ce78b8e28301738740a1ab4e2e2738))
* **desktop:** send recommendation feedback with the batch it judges ([781827c](https://github.com/eikrad/bandsearch-app/commit/781827c4acd9e60511e3a746c9d8a9e23200f8fa)), closes [#307](https://github.com/eikrad/bandsearch-app/issues/307)
* **desktop:** show a failed retry and stop repeating the question ([ff9f064](https://github.com/eikrad/bandsearch-app/commit/ff9f064cd0d97f0adadeed23f697594c7010dc5d))
* **desktop:** show a failed retry and stop repeating the question ([6f90731](https://github.com/eikrad/bandsearch-app/commit/6f907314313b9323d96136ed2f486b1a26365834)), closes [#304](https://github.com/eikrad/bandsearch-app/issues/304)
* **test:** clean storage fixtures after native processes exit ([3058075](https://github.com/eikrad/bandsearch-app/commit/305807579146641d0f977b277f2943f85ed99577))


### Performance

* **api:** ask Last.fm alongside verification and remember artists ([76cb2dd](https://github.com/eikrad/bandsearch-app/commit/76cb2dd29c12a4f5c7b19144357a1b460aa7633c)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** do not wait out a busy MusicBrainz for aliases ([aa13fff](https://github.com/eikrad/bandsearch-app/commit/aa13fff9403f47dcfb444cebcd1cb45c137a502a)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** plan only searched queries and extract hit numbers ([aac062e](https://github.com/eikrad/bandsearch-app/commit/aac062eac6afc17542892b0d79770d2fe1461980)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** read more hits per search ([5cf2705](https://github.com/eikrad/bandsearch-app/commit/5cf270594718f73e828bd97ea361293214625bb3)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** stop searching once the extractor has enough hits ([ec2f9ec](https://github.com/eikrad/bandsearch-app/commit/ec2f9ecd961e078f1dce3f31ed8604e71ce18fb0)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)
* **api:** verify candidates in one batched MusicBrainz search ([9fcbbd7](https://github.com/eikrad/bandsearch-app/commit/9fcbbd78ef022a784c1bc2f01ec7e7db80691d0c)), closes [#336](https://github.com/eikrad/bandsearch-app/issues/336)

## [0.4.5](https://github.com/eikrad/bandsearch-app/compare/v0.4.4...v0.4.5) (2026-11-16)


### Bug Fixes

* **desktop:** preserve artist identity across saved-band actions ([5fd2ff7](https://github.com/eikrad/bandsearch-app/commit/5fd2ff72a6a68caa4ff50109e28d02ac56118ac5))

## [0.4.4](https://github.com/eikrad/bandsearch-app/compare/v0.4.3...v0.4.4) (2026-10-23)


### Security

* **desktop:** distrust the compromised eMudhra intermediates ([8f72fdb](https://github.com/eikrad/bandsearch-app/commit/8f72fdbd6f342806dd5e5261c1eb81b616b32844))
* run Node 26.12.1 on Render, in CI and as the desktop sidecar ([de8ada2](https://github.com/eikrad/bandsearch-app/commit/de8ada21ebdeda9aaebbfa42e7c1808925f4ea3f))

## [0.4.3](https://github.com/eikrad/bandsearch-app/compare/v0.4.2...v0.4.3) (2026-10-11)


### Features

* **api:** email-bound invite repository and disabled users ([a00e3b8](https://github.com/eikrad/bandsearch-app/commit/a00e3b8112ef8300b7a24c1a9acadd1a8e8811f3))
* **api:** enforced auth mode for closed deployments ([996b3a8](https://github.com/eikrad/bandsearch-app/commit/996b3a87be69d6ded1eb46bd03f9c2710f344324))
* **api:** invite and user admin CLI ([464fca9](https://github.com/eikrad/bandsearch-app/commit/464fca94a10bf543d70b3e41192d6b54bd554635))
* **api:** rate-limit auth routes ([7cb0722](https://github.com/eikrad/bandsearch-app/commit/7cb07225ec6b567da4d73a2e439e72bba6c67cc0))
* **api:** require an invite code to register in enforced mode ([3273fd3](https://github.com/eikrad/bandsearch-app/commit/3273fd3195d171a168131949bc6dd8f2dda564d2))
* closed beta with email-bound invites and enforced auth mode ([3deeb09](https://github.com/eikrad/bandsearch-app/commit/3deeb095c918f4a5549da856a7f486109af6ed22))
* **desktop:** invite code on registration and gate routing ([38dbdae](https://github.com/eikrad/bandsearch-app/commit/38dbdae1e58e374b45abc77bd7f86f03e5f3504c))


### Bug Fixes

* **api:** trust proxy for client-IP rate limiting ([9dc8778](https://github.com/eikrad/bandsearch-app/commit/9dc8778b1ef749af197b60d65a13d66e4ed9d001))

## [0.4.2](https://github.com/eikrad/bandsearch-app/compare/v0.4.1...v0.4.2) (2026-10-07)


### Features

* **api:** artist country and band members from MusicBrainz ([1408931](https://github.com/eikrad/bandsearch-app/commit/1408931459dd77752e75b15ec17db1eb460c62e2)), closes [#253](https://github.com/eikrad/bandsearch-app/issues/253)
* **api:** choose the research and judge models per role, with a provider switch ([b0e422e](https://github.com/eikrad/bandsearch-app/commit/b0e422e041908b5b1ff237b221b232be23d7b1cb)), closes [#237](https://github.com/eikrad/bandsearch-app/issues/237)
* **api:** name the generating model in recommendation provenance ([c265abf](https://github.com/eikrad/bandsearch-app/commit/c265abf839fb22ceb6583a519e8f7a4baa8c902f)), closes [#134](https://github.com/eikrad/bandsearch-app/issues/134)
* **api:** Scaleway chat client behind the shared model interface ([92bb2a8](https://github.com/eikrad/bandsearch-app/commit/92bb2a825bc34f3b65103ee102948dc92f078a46)), closes [#237](https://github.com/eikrad/bandsearch-app/issues/237)
* **api:** Scaleway is the default LLM provider ([8f7dd2f](https://github.com/eikrad/bandsearch-app/commit/8f7dd2f544cbf42a9b4aedffe95123dbd254e642)), closes [#237](https://github.com/eikrad/bandsearch-app/issues/237)
* **desktop:** a vendor-neutral LLM key for the local sidecar, and Scaleway in the UI ([bcc69cc](https://github.com/eikrad/bandsearch-app/commit/bcc69cc9040caf73c47490d3e640a99e1b7eddc3)), closes [#237](https://github.com/eikrad/bandsearch-app/issues/237)
* **eval:** calibrate the production judge on Scaleway and record every run ([374e9f4](https://github.com/eikrad/bandsearch-app/commit/374e9f424c52bbe715db8c2310d57abdf2a6dd14))
* **eval:** constraint queries — a third gate checked deterministically ([148aebd](https://github.com/eikrad/bandsearch-app/commit/148aebdc5d75f6d21eacd58bfc8aa0bfc6d6995d)), closes [#253](https://github.com/eikrad/bandsearch-app/issues/253)
* **eval:** constraint queries checked deterministically against MusicBrainz ([037fc92](https://github.com/eikrad/bandsearch-app/commit/037fc928572bd6ed3f42995f5c1819d5cde9fc36))
* **eval:** coverage from Last.fm tags where MusicBrainz has none; record replay ([b53a493](https://github.com/eikrad/bandsearch-app/commit/b53a493f831e9c61fd75200cc8d3d6f32336a576)), closes [#250](https://github.com/eikrad/bandsearch-app/issues/250)
* **eval:** golden-run history, dashboard and model provenance ([e49230b](https://github.com/eikrad/bandsearch-app/commit/e49230bca140e53e7a996f7ea6d19b666dc94659))
* **eval:** judge scores in golden runs ([46160cf](https://github.com/eikrad/bandsearch-app/commit/46160cf09dbf82dc5d425b0feb81f0ff3a662e68))
* **eval:** judge with votes, shuffled band order and per-band calls ([9b69e4f](https://github.com/eikrad/bandsearch-app/commit/9b69e4f9544d2a2315dccf68c654bf65c710b6c2))
* **eval:** Last.fm top tags per artist ([40b0110](https://github.com/eikrad/bandsearch-app/commit/40b01100f7205116e705b9cbd806b0551664f572)), closes [#250](https://github.com/eikrad/bandsearch-app/issues/250)
* **eval:** model comparison — judge glm-5.2, research deepseek-v4-flash on Scaleway ([09edd87](https://github.com/eikrad/bandsearch-app/commit/09edd875bbedc2df0f69a7bf8b488499e3086af8))
* **eval:** record and replay external lookups for eval runs ([14b3594](https://github.com/eikrad/bandsearch-app/commit/14b3594bb1d80b01b8e8d220fe42aa367a44fcb9)), closes [#250](https://github.com/eikrad/bandsearch-app/issues/250)
* **eval:** record every golden run in a committed history ([fe7e547](https://github.com/eikrad/bandsearch-app/commit/fe7e54723ec1e6e46306bc86c38f1d11d219a5bf)), closes [#209](https://github.com/eikrad/bandsearch-app/issues/209)
* **eval:** repeats per setup, compared per query with a paired bootstrap ([ce0413b](https://github.com/eikrad/bandsearch-app/commit/ce0413b847024de5456351fadf3baafe6259fc75)), closes [#250](https://github.com/eikrad/bandsearch-app/issues/250)
* **eval:** run the live judge on Scaleway through the shared model interface ([182f2c7](https://github.com/eikrad/bandsearch-app/commit/182f2c7f628fa0bc047387591c32d12a4295b4b8))
* **eval:** self-contained dashboard comparing golden runs ([7dbec76](https://github.com/eikrad/bandsearch-app/commit/7dbec76cd3d4fc7303127a2ca60351a61747f5f7)), closes [#209](https://github.com/eikrad/bandsearch-app/issues/209)
* **eval:** six constraint queries, and docs for constraint checking ([35726c2](https://github.com/eikrad/bandsearch-app/commit/35726c29a26b7ea9b2cad8cc560d4e212e09f425)), closes [#253](https://github.com/eikrad/bandsearch-app/issues/253)
* **eval:** stable golden measurement — replay, Last.fm tags, setups with paired statistics ([7a3061d](https://github.com/eikrad/bandsearch-app/commit/7a3061dd4f8180d568df43df7d0d749f0682093f))
* Scaleway as the default LLM provider ([f3c12f7](https://github.com/eikrad/bandsearch-app/commit/f3c12f7d3d52ea9c949795a7a617c4e5dd433b07))
* Scaleway behind LLM_PROVIDER, judge and calibration on Scaleway ([65fd835](https://github.com/eikrad/bandsearch-app/commit/65fd835aaf5eb314356b3741cc7a31f121fd7797))
* Scaleway defaults chosen by measurement — deepseek-v4-flash-0731 and glm-5.2 ([b208b7a](https://github.com/eikrad/bandsearch-app/commit/b208b7aa8faa99f1e8179fc1b6a5c85fb83a9698)), closes [#204](https://github.com/eikrad/bandsearch-app/issues/204)


### Bug Fixes

* **api:** degrade instead of failing when an optional research step errors ([342a55b](https://github.com/eikrad/bandsearch-app/commit/342a55b2e2c4264083f70dba06af18d67800e222))
* **api:** degrade instead of failing when an optional research step errors ([e80fce9](https://github.com/eikrad/bandsearch-app/commit/e80fce926be899a87fcf4042e8e5d6fc0bb336a2)), closes [#241](https://github.com/eikrad/bandsearch-app/issues/241)
* **api:** keep tests out of the dev SQLite database ([635e805](https://github.com/eikrad/bandsearch-app/commit/635e805b8559f6bd4b3e75a45a7c16570559ddf0))
* **api:** keep tests out of the dev SQLite database ([a479286](https://github.com/eikrad/bandsearch-app/commit/a4792864f8a22cba2d1d154b9d2e72ffe8fa3aec))
* **api:** turn off Scaleway reasoning unless a role asks for it ([e1293a0](https://github.com/eikrad/bandsearch-app/commit/e1293a01781727d541584983c1e6c153478e64ac)), closes [#237](https://github.com/eikrad/bandsearch-app/issues/237)
* **eval:** an answer without any band fails the query ([d14648d](https://github.com/eikrad/bandsearch-app/commit/d14648d9cf1cff42c8bf498c67b49b7b24316f99)), closes [#253](https://github.com/eikrad/bandsearch-app/issues/253)
* **eval:** record coverage without MusicBrainz tags as unknown, not zero ([46d431b](https://github.com/eikrad/bandsearch-app/commit/46d431b4e608c42ce24d2b1f2e1ff3ca311dd2fd)), closes [#209](https://github.com/eikrad/bandsearch-app/issues/209)
* **eval:** ut-13 expected a judgement the judge prompt rules out; history never marks a run dirty ([d205031](https://github.com/eikrad/bandsearch-app/commit/d205031bb89897dcf03595c1e79833f175a580aa))
* **privacy:** name Scaleway as the optional quality-scoring recipient ([09b3ac9](https://github.com/eikrad/bandsearch-app/commit/09b3ac90fca3c3e0c1f444a71f3487ff8ab66fa6)), closes [#237](https://github.com/eikrad/bandsearch-app/issues/237)

## [0.4.1](https://github.com/eikrad/bandsearch-app/compare/v0.4.0...v0.4.1) (2026-10-03)


### Features

* **api:** let a saved band have no rating ([6e0f08f](https://github.com/eikrad/bandsearch-app/commit/6e0f08fad728a8c028f13126e2a33573eb001680))
* **api:** tell the model when a saved band is unrated ([78deb3b](https://github.com/eikrad/bandsearch-app/commit/78deb3b5342bc203d97f21af6474a0ebf66cafca))
* **desktop:** add the update notification banner ([132accb](https://github.com/eikrad/bandsearch-app/commit/132accb8954865588740531c94ec5288533266ed))
* **desktop:** card-action redesign — rating stars, Save/Saved toggle, Category/Note sheet ([9196b99](https://github.com/eikrad/bandsearch-app/commit/9196b99a75686f7bd013188c3f88496bc821ed5c))
* **desktop:** card-action redesign — rating stars, Save/Saved toggle, Category/Note sheet ([8ad6eef](https://github.com/eikrad/bandsearch-app/commit/8ad6eef11382f3b328df4921bb6b775bec1c464a))
* **desktop:** check for updates on startup and expose install_update ([d3e23a8](https://github.com/eikrad/bandsearch-app/commit/d3e23a870539a8d540eca4a6a9013952ddeb72ca))
* **desktop:** decide when an update banner is shown ([044e762](https://github.com/eikrad/bandsearch-app/commit/044e762d96e59db7f74a9ae38c889adaa24b0c4b))
* **desktop:** in-app update notification (Phase 10) ([ea87cb3](https://github.com/eikrad/bandsearch-app/commit/ea87cb3b0948815e3d988bd21eeaab5ffbfa7f30))
* **desktop:** mbid-based save/rate lookups, unrate, category+note save ([#163](https://github.com/eikrad/bandsearch-app/issues/163)) ([1a82936](https://github.com/eikrad/bandsearch-app/commit/1a82936f91b1cfcf9a548b4625a9a3cc4ba7be14))
* **desktop:** rating stars, Save/Saved toggle, Category/Note sheet ([#151](https://github.com/eikrad/bandsearch-app/issues/151), [#153](https://github.com/eikrad/bandsearch-app/issues/153), [#165](https://github.com/eikrad/bandsearch-app/issues/165)) ([8725fa4](https://github.com/eikrad/bandsearch-app/commit/8725fa4363af142d0aa868ebb09644cbec9771d2))
* **desktop:** retry the auth status check while the API is waking ([a775320](https://github.com/eikrad/bandsearch-app/commit/a775320e15d8431e1ab732f0b4ef96a24e51e7cb))
* **desktop:** save/rate never collapse on mobile; cards carry category/note ([#152](https://github.com/eikrad/bandsearch-app/issues/152), [#163](https://github.com/eikrad/bandsearch-app/issues/163)) ([366838d](https://github.com/eikrad/bandsearch-app/commit/366838d8606617b6eb2b76372b359ee9cd4f2f49))
* **desktop:** show a connecting state while the API wakes up ([9dd8115](https://github.com/eikrad/bandsearch-app/commit/9dd8115b3a52ba05550ada0d00e59c2a0dbcddfa))
* **desktop:** show the update banner when a new version is available ([3e2d993](https://github.com/eikrad/bandsearch-app/commit/3e2d993c88244e200b0b8cac5fa442775de35551))
* **preferences:** dedup saves and track note provenance ([#163](https://github.com/eikrad/bandsearch-app/issues/163), [#166](https://github.com/eikrad/bandsearch-app/issues/166)) ([b1ac80e](https://github.com/eikrad/bandsearch-app/commit/b1ac80e6ce93fa7fbdd4cf366ce0c32633d0886d))
* **preferences:** exclude unedited notes from the recommendation prompt ([#166](https://github.com/eikrad/bandsearch-app/issues/166)) ([fc05bb9](https://github.com/eikrad/bandsearch-app/commit/fc05bb91243c6e8ffc8e54c22c6b585a5f4c97b7))
* **schemas:** accept a saved band without a rating ([c21273d](https://github.com/eikrad/bandsearch-app/commit/c21273d034d3c1de23efbc90b87ad349a32388fd))


### Bug Fixes

* a saved band may have no rating ([#164](https://github.com/eikrad/bandsearch-app/issues/164), [#167](https://github.com/eikrad/bandsearch-app/issues/167)) ([c22a871](https://github.com/eikrad/bandsearch-app/commit/c22a87155005db121a03699d11c18519bf21ff98))
* **api:** saving an unrated band 500s on Turso (regression from [#164](https://github.com/eikrad/bandsearch-app/issues/164)) ([9d1d99f](https://github.com/eikrad/bandsearch-app/commit/9d1d99fd75fd0061f66b252a5a7212d9ac40e4ee))
* **api:** saving an unrated band no longer fails on Turso ([fe89880](https://github.com/eikrad/bandsearch-app/commit/fe8988063bcdea6d6aea9ec7265a75c903996dcf))
* **deploy:** prepare script broke the Render build ([8c6d9c8](https://github.com/eikrad/bandsearch-app/commit/8c6d9c831a113770c31af50ba29f800246aa60d8))
* **deploy:** prepare script broke the Render build ([8394f5c](https://github.com/eikrad/bandsearch-app/commit/8394f5ca2d837681e37584aa8d239fd953d3296e))
* **deploy:** render.yaml health check path and branch ([184eb6e](https://github.com/eikrad/bandsearch-app/commit/184eb6e1b332b26f274b939fb1b421c7212eedbf))
* **deploy:** render.yaml health check path and branch ([e187bb9](https://github.com/eikrad/bandsearch-app/commit/e187bb960f322d22416e300d9a17a3eb507debb6))
* **deploy:** render.yaml health check pointed at a route that doesn't exist ([06f52ec](https://github.com/eikrad/bandsearch-app/commit/06f52eceb089995eba0f9c8906a82d0caea3e888))
* **desktop:** a failed save or rating showed nothing at all ([a9f055c](https://github.com/eikrad/bandsearch-app/commit/a9f055c21e349af54ba5a3bb6ba3353038db7991))
* **desktop:** Bandcamp/Spotify/SoundCloud links did nothing in the app ([5de0016](https://github.com/eikrad/bandsearch-app/commit/5de00168240957c63bc53f419a0313a0389fa06f))
* **desktop:** chat sessions never actually persisted across restarts ([887ebda](https://github.com/eikrad/bandsearch-app/commit/887ebdae574ece2fead6b39063fb5ec38a90a882))
* **desktop:** distinguish an unreachable API from disabled auth ([489c94d](https://github.com/eikrad/bandsearch-app/commit/489c94ddd6af82d7f407ef838d3cdc7fe939dd82))
* **desktop:** distinguish an unreachable API from disabled auth ([#155](https://github.com/eikrad/bandsearch-app/issues/155)) ([825e870](https://github.com/eikrad/bandsearch-app/commit/825e8707f358e3d4261504fd963bb5575c0ba938))
* **desktop:** platform links did nothing in browser dev mode ([be5fbbe](https://github.com/eikrad/bandsearch-app/commit/be5fbbe340f5d3d59dcd84df18bb69ae1fd82c5e))
* **desktop:** platform links did nothing in browser dev mode ([7120bf2](https://github.com/eikrad/bandsearch-app/commit/7120bf2b187b161b0c0c317c590832332ce6dd79))
* **desktop:** platform links do nothing, chat sessions don't survive a restart ([404c952](https://github.com/eikrad/bandsearch-app/commit/404c9527ec152a7e408046d5c7246e7e74407c4d))
* **desktop:** platform links do nothing, chat sessions don't survive a restart ([435e554](https://github.com/eikrad/bandsearch-app/commit/435e5542561632846cb6eee5cce5f569317895f6))
* **desktop:** point the API endpoint placeholder at the real production host ([5329fa8](https://github.com/eikrad/bandsearch-app/commit/5329fa85809fbb32ceb6c3c1c3d04478713fde7b))
* **desktop:** point the API endpoint placeholder at the real production host ([0b3c2f2](https://github.com/eikrad/bandsearch-app/commit/0b3c2f2875176af9ff8e22fcc03da0ed3af8e77b)), closes [#223](https://github.com/eikrad/bandsearch-app/issues/223)
* **desktop:** stop writing a rating the user did not choose ([21a4a45](https://github.com/eikrad/bandsearch-app/commit/21a4a45fd9e6b5a800b0899a166aa526def667e3))
* **desktop:** wire up GDPR export and account deletion ([cfb91f0](https://github.com/eikrad/bandsearch-app/commit/cfb91f0ee39184d289931bc13608ad4a441ca8b8))
* **desktop:** wire up GDPR export and account deletion ([#175](https://github.com/eikrad/bandsearch-app/issues/175)) ([06e1ba7](https://github.com/eikrad/bandsearch-app/commit/06e1ba731b142e84a8718b54a710bc04b7f72c10))
* **eval:** record the judge model that was actually called ([cad6ff3](https://github.com/eikrad/bandsearch-app/commit/cad6ff37390e4179f7b365db4e5fce25969824c8))
* **eval:** record the judge model that was actually called ([a87d5b9](https://github.com/eikrad/bandsearch-app/commit/a87d5b9806603b97565c4fca76a079d4143e1705))
* **eval:** remove precision@8, which measured recall and duplicated nuggetCoverage ([a999018](https://github.com/eikrad/bandsearch-app/commit/a99901814d0a4b876c850782ed1f36f21bd5dcc4))
* **eval:** score golden nuggets against MusicBrainz tags ([818dfe3](https://github.com/eikrad/bandsearch-app/commit/818dfe3c8f8c7aaa0e795a0e09b7be60225d8541))
* **eval:** score golden nuggets against MusicBrainz tags ([12d2164](https://github.com/eikrad/bandsearch-app/commit/12d2164cc84045a79178dbdaf28e0af384311d5f))
* **eval:** the judge calls Mistral, which is what MISTRAL_API_KEY meant ([77092f0](https://github.com/eikrad/bandsearch-app/commit/77092f0c7fd093811f138a96b927beec57dc2dfc))
* **eval:** the judge calls Mistral, which is what MISTRAL_API_KEY meant ([7a3bb79](https://github.com/eikrad/bandsearch-app/commit/7a3bb793ad519ef26bd0cda1a4bec717e725a764))
* stop the specs asserting behaviour the code does not have ([f5993aa](https://github.com/eikrad/bandsearch-app/commit/f5993aa6f75a2bb537a9ed3750dd5ead8b1deae6))
* stop the specs asserting behaviour the code does not have ([96a454c](https://github.com/eikrad/bandsearch-app/commit/96a454c24673f12264e21635f82cf4f2105dfdbb))
* two defects a cleanup review found in today's merged work ([fdd0434](https://github.com/eikrad/bandsearch-app/commit/fdd04345d9bbfa8c0eab4edc0e44c88b19c109ac))
