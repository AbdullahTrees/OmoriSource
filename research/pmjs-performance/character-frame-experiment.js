// Test-only specialization for the reviewed OMORI MV/custom-rectangles/EMF composition.
(function() {
  'use strict';
  var root = globalThis, require = root.__pmjsBuiltinRequire;
  var expected = {
  "frame": [
    "61f013f3e685102f24712e68f58e322320f9d8eeff9a2829c9f892eca7385b61"
  ],
  "isSingleFrame": [
    "d82dd1a23f3ec21e623ae5faecdf50410c05b8fe1262cf02e311ba10b0ff51e2"
  ],
  "isEmfCharacter": [
    "5454731bc7408427dffbdd1209ec84eaa437a3de8b7bc4d4cada019bbdf827d1"
  ],
  "inner": [
    "86e6bf743c4ee448859c60e8706e5e339f6bf0316c42809d8608f7c5065fe3cd"
  ],
  "emfWidth": [
    "46d44179ca8be450446e5486f0833d96341cccf2818bc772256de52f0ab5e3f6"
  ],
  "characterBlockX": [
    "46a829c6b4265898fc47a2077aa9ef5b91640ea111dc46c5877647085d547994"
  ],
  "alias_characterBlockX": [
    "76d7c5af3b172bb03cb15aedf693673a32e4760c0c7a95a79bc420a5983317d1"
  ],
  "characterBlockY": [
    "c7a6a1180963924d85e5690fca7d4c3214723a1ba5745819d6ae8c1276a1a1f4"
  ],
  "alias_characterBlockY": [
    "20953a88f0212e8821f2ed3cc0e3557ecf2988c1082a7c3dbc6444f89cea6de6"
  ],
  "characterPatternX": [
    "19ee1460e719357be72cf38ed13dceca5b29a4ba8dd9c42ffd05f7c503d37c09"
  ],
  "alias_characterPatternX": [
    "d8367f4faa2dd88f43d512d35c9c2af9873798f219bac91f4589c9d88f1c6b95"
  ],
  "characterPatternY": [
    "6d975bc75b8541627c0d60f094d9dfb073b1451f1b715c16ecad858d69ff89c5"
  ],
  "alias_characterPatternY": [
    "d82f8f1ef9c986740a1d6e0aed4c655f17a2847ddfe3305a5737859694d8c59d"
  ],
  "patternWidth": [
    "b1bfbf3b8cf68f9a0affbdebd062f1a2e0678aedc2928a33bbe05ed2d5fcda20"
  ],
  "alias_patternWidth": [
    "11f74cb7dc64c70c7bdca47d687d45670d0e9b9846b52a4539832565055945d6"
  ],
  "patternHeight": [
    "c7c648b4ac8f4b5099de26a264a516827ca8cc24ba409119c1592dcc0d3c3b67"
  ],
  "alias_patternHeight": [
    "6bcbe7b8a62bed13e40f7f299222c571593ee561cc9d1b6e484d0a006318d7d3"
  ]
};
  function hash(fn) {
    return typeof fn === 'function' ? require('node:crypto').createHash('sha256')
      .update(Function.prototype.toString.call(fn).replace(/\r\n/g, '\n')).digest('hex') : '';
  }
  function install() {
    var proto = Sprite_Character.prototype, characterProto = Game_CharacterBase.prototype;
    var custom = _TDS_.CustomCharacterRectangles, emf = ModernAlgebra.EMF;
    var frame = proto.updateCharacterFrame;
    var names = ['characterBlockX','characterBlockY','characterPatternX','characterPatternY','patternWidth','patternHeight'];
    var methods = {}, aliases = {}, checks = { frame: frame,
      isSingleFrame: characterProto.isSingleFrame, isEmfCharacter: characterProto.isEmfCharacter,
      inner: _TDS_.OmoriBASE.Sprite_Character_updateCharacterFrame,
      emfWidth: emf.SpriteCharacter_patternWidth };
    names.forEach(function(name) {
      methods[name] = proto[name];
      aliases[name] = custom['Sprite_Character_'+name];
      checks[name] = methods[name]; checks['alias_'+name] = aliases[name];
    });
    var failures = Object.keys(checks).filter(function(name) { return !(expected[name] || []).includes(hash(checks[name])); });
    if (failures.length) {
      console.log('[frame-experiment] refused '+JSON.stringify(failures.map(function(name) { return [name,hash(checks[name])]; })));
      return;
    }
    var enabled = false, hits = 0, fallbacks = 0;
    var fastUpdate = function() {
      var character = this._character, bitmap = this.bitmap;
      if (enabled && character && bitmap && bitmap.width > 0 && bitmap.height > 0 && this._tileId === 0 &&
          character.isSingleFrame === checks.isSingleFrame && !character._singleFrame &&
          character.isEmfCharacter === checks.isEmfCharacter && !character._isEmfCharacter &&
          character._customFrameX === null && character._customFrameY === null &&
          character._customFrameWidth === null && character._customFrameHeight === null &&
          this.characterBlockX === methods.characterBlockX && this.characterBlockY === methods.characterBlockY &&
          this.characterPatternX === methods.characterPatternX && this.characterPatternY === methods.characterPatternY &&
          this.patternWidth === methods.patternWidth && this.patternHeight === methods.patternHeight &&
          _TDS_.OmoriBASE.Sprite_Character_updateCharacterFrame === checks.inner &&
          _TDS_.CustomCharacterRectangles === custom && ModernAlgebra.EMF === emf &&
          emf.SpriteCharacter_patternWidth === checks.emfWidth &&
          custom.Sprite_Character_characterBlockX === aliases.characterBlockX &&
          custom.Sprite_Character_characterBlockY === aliases.characterBlockY &&
          custom.Sprite_Character_characterPatternX === aliases.characterPatternX &&
          custom.Sprite_Character_characterPatternY === aliases.characterPatternY &&
          custom.Sprite_Character_patternWidth === aliases.patternWidth &&
          custom.Sprite_Character_patternHeight === aliases.patternHeight) {
        hits++;
        var width = bitmap.width / (this._isBigCharacter ? 3 : 12);
        var height = bitmap.height / (this._isBigCharacter ? 4 : 8);
        var customX = character._customFrameX;
        var blockX = customX !== null ? customX : this._isBigCharacter ? 0 : character.characterIndex() % 4 * 3;
        var patternX = character._customFrameX !== null ? 0 : character.pattern();
        var x = (blockX + patternX) * width;
        var customY = character._customFrameY;
        var blockY = customY !== null ? customY : this._isBigCharacter ? 0 : Math.floor(character.characterIndex()/4) * 4;
        var patternY = character._customFrameY !== null ? 0 : (character.direction()-2)/2;
        var y = (blockY + patternY) * height;
        this.updateHalfBodySprites();
        if (this._bushDepth > 0) {
          var depth = this._bushDepth;
          this._upperBody.setFrame(x,y,width,height-depth);
          this._lowerBody.setFrame(x,y+height-depth,width,depth);
          this.setFrame(x,y,0,height);
        } else this.setFrame(x,y,width,height);
        return;
      }
      if (enabled) fallbacks++;
      return frame.apply(this, arguments);
    };
    root.__omoriFrameExperiment = {
      setEnabled: function(value) {
        if (proto.updateCharacterFrame !== frame && proto.updateCharacterFrame !== fastUpdate)
          throw new Error('frame method changed during experiment');
        enabled = !!value;
        // The disabled phase is the actual original method, without an extra wrapper.
        proto.updateCharacterFrame = enabled ? fastUpdate : frame;
      },
      snapshot: function() { return { enabled: enabled, hits: hits, fallbacks: fallbacks }; }
    };
    console.log('[frame-experiment] installed');
  }
  var timer = setInterval(function() {
    if (!root.SceneManager || !SceneManager._scene || SceneManager._scene.constructor.name !== 'Scene_OmoriTitleScreen') return;
    clearInterval(timer);
    try { install(); } catch (error) { console.log('[frame-experiment] failed '+String(error.stack || error)); }
  }, 50);
})();
