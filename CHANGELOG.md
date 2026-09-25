# Changelog

## [0.3.0](https://github.com/xiprox/fsc-editor/compare/v0.2.0...v0.3.0) (2026-09-25)


### Features

* **editor:** B: input events complete in two steps, the control then its suffix ([4f9134a](https://github.com/xiprox/fsc-editor/commit/4f9134af3d96ce1fc4dc8c34bb662e9d40cc63e9))
* **editor:** hovering a live value explains it the first three times ([d0398e5](https://github.com/xiprox/fsc-editor/commit/d0398e58f3dc7d1febe8f3913fbd31c173579d56))
* **editor:** hovering the run button explains it the first three times ([fa1028f](https://github.com/xiprox/fsc-editor/commit/fa1028f571ae4ffef7d8a9a244651ff1f062169e))
* **editor:** live values no longer start with an arrow ([2b874ed](https://github.com/xiprox/fsc-editor/commit/2b874ede4016b6b7d948a2fac48abfbfa91392cf))
* **updates:** after an update, the app shows what changed ([a95f280](https://github.com/xiprox/fsc-editor/commit/a95f280d35580ddd8de974bd854e05cb70acffea))
* **updates:** check for updates from the FSC Editor menu ([25ee540](https://github.com/xiprox/fsc-editor/commit/25ee5404223b9fb42b56b9f56c06f75fe3d73946))
* **updates:** What's new lists what changed in every release ([ba246c9](https://github.com/xiprox/fsc-editor/commit/ba246c912c069c1b59adc97b23f23ad5de429cc7))


### Bug Fixes

* **editor:** a setter offers its entry's own variable first ([cf0216d](https://github.com/xiprox/fsc-editor/commit/cf0216d48cff23bf412813c2bdd07ccbc2580bfb))
* **editor:** completions offer names from a profile you just saved ([94956c1](https://github.com/xiprox/fsc-editor/commit/94956c14906dc61bc0567d7ae24339a51122b669))
* **editor:** pressing Enter after a get: entry no longer carries its live value down ([16578f6](https://github.com/xiprox/fsc-editor/commit/16578f6384dc09cd7605b9ec2a1b9063a4f728c8))
* **trace:** a setter with no write at the end shows what really happens to the value ([388f64b](https://github.com/xiprox/fsc-editor/commit/388f64bfc85cfd986d6125de182f058c9ad4a711))

## [0.2.0](https://github.com/xiprox/fsc-editor/compare/v0.1.2...v0.2.0) (2026-09-21)


### Features

* **profiles:** click the open profile again to show or hide its sections ([f266ba7](https://github.com/xiprox/fsc-editor/commit/f266ba7f1ff49095a5cf42452a381223f2d43148))
* **profiles:** collapse the Profiles panel from its rail or with Ctrl+B ([1991be2](https://github.com/xiprox/fsc-editor/commit/1991be2bc59db309d8ff121c82c737e533c8d4f4))
* **radar:** auto-capture can be Off, Once or Always, remembered per aircraft ([6436156](https://github.com/xiprox/fsc-editor/commit/6436156722e14085173484c95d76bed8be4d58f4))
* **radar:** right-click a captured control to copy its name ([2863ddf](https://github.com/xiprox/fsc-editor/commit/2863ddfacdeb15dc20b683a41133685ce3835697))
* **radar:** right-click a captured control to ignore it on this aircraft ([fb27d39](https://github.com/xiprox/fsc-editor/commit/fb27d3963287955ae2f35523d2e6667e93799773))
* **radar:** show captured controls as B: names in the editor's colours ([7cac4d5](https://github.com/xiprox/fsc-editor/commit/7cac4d5e645f079847e8d50c79c6ca3b47f61e9d))
* **variables:** a namespace prefix in the search shows as a pill ([05ef3b9](https://github.com/xiprox/fsc-editor/commit/05ef3b9524c2387345b5b2814bfd5e7717208b8e))
* **variables:** quoted search terms match literally ([8d08907](https://github.com/xiprox/fsc-editor/commit/8d08907c2e2b5caa70e5353dfac3ef4e1dc72cfe))
* **variables:** right-click a variable to copy its name or value ([eb844c1](https://github.com/xiprox/fsc-editor/commit/eb844c105035ad9c85fd226d44525726066c3f2e))


### Bug Fixes

* **editor:** the mouse wheel scrolls the tab bar ([6a5ca99](https://github.com/xiprox/fsc-editor/commit/6a5ca993abc8436f6500a5ccaf79726081fb9908))
* **profiles:** the outline follows the caret, and the viewport once the caret is off screen ([d65be56](https://github.com/xiprox/fsc-editor/commit/d65be562c72eb9b80a22740c302d4a5f3462a808))
* **profiles:** the profile list fits the panel's width again ([70daba2](https://github.com/xiprox/fsc-editor/commit/70daba2aa803ccc478ce4fda7a5201424bbadb42))
* **variables:** bring back B: aircraft connection notice ([2f66410](https://github.com/xiprox/fsc-editor/commit/2f664108ca283554e526642fae8d6d4ddef8c15a))
* **variables:** keep search and scroll state when panel is hidden ([cbd14f3](https://github.com/xiprox/fsc-editor/commit/cbd14f3b7e065cc5fe08d06c90a2e0b4743220a0))

## [0.1.2](https://github.com/xiprox/fsc-editor/compare/v0.1.1...v0.1.2) (2026-09-20)


### Bug Fixes

* **sim:** put Uninstall with the folder it acts on ([13e161a](https://github.com/xiprox/fsc-editor/commit/13e161a64217cfc151804facec612c8fe22e26dc))

## [0.1.1](https://github.com/xiprox/fsc-editor/compare/v0.1.0...v0.1.1) (2026-09-20)


### Bug Fixes

* **sim:** upadte sim module pitch ([4afcca3](https://github.com/xiprox/fsc-editor/commit/4afcca377a9f261cf8fa8e3343e9b4623c784643))

## 0.1.0 (2026-09-20)


### Features

* **profiles:** add New profile, and write new profiles immediately ([8af4840](https://github.com/xiprox/fsc-editor/commit/8af4840c51a20499267747b7651dff0ce78406db))
* **profile:** teach the format in the starter profile ([0fdb9a5](https://github.com/xiprox/fsc-editor/commit/0fdb9a5dd774861ba679b0d8414a63af81b9e351))
* **workspace:** accept an empty folder at setup ([44f7274](https://github.com/xiprox/fsc-editor/commit/44f72744346e8e1e751ce0b29078eaea8ce91a10))
