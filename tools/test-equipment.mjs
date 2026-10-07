// P2k1: historical generic oracle captured before equipment runtime edits.
// Parent a408c3fc704752fda2bf2f598dfd2886e8c73b0f; expectations are immutable historical data, never generated from edited runtime.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EntityManager } from 'yuka';
import { Unit } from '../src/units/unit.js';
import { Game } from '../src/game.js';
import { Combat } from '../src/sim/combat.js';
import { RULES } from '../src/sim/rules.js';
import { makeRng } from '../src/reward/model.js';
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const HISTORICAL_SOURCES = [{"path":"src/units/unit.js","bytes":32288,"sha256":"ff8ce2053f80fe433ec27bd4acc49788914be05484308ebfdcd1c96c33e8d2e2"},{"path":"src/sim/combat.js","bytes":15948,"sha256":"c2170cafab333452272d40f13c6967ee6520078d941d9506853ff7ea58961513"},{"path":"src/game.js","bytes":29516,"sha256":"f95ac81c905f82bb85bf36c08c7794e21ee11eed0600c98889d5a2f0ec3ca95b"},{"path":"src/ui/arrows.js","bytes":20515,"sha256":"3e01e2bdd461eb4dd9ca95f79a133d9ab5cc02f6b6307a501ccce309b7bf8e17"},{"path":"src/ui/input.js","bytes":28503,"sha256":"da0a6a3c67d0afdc13f6fbe4f9141286e06fbbf3a6a2c382b6622fef635345ea"},{"path":"src/sim/rules.js","bytes":3299,"sha256":"98d8681c2093720b0b57a4d940c8f18f240fdc1ccb0c86893c067d484f636b8b"},{"path":"src/reward/model.js","bytes":11551,"sha256":"2e5f195ee9e6ea8b9cce25b5895bb8b7a169b8c17a2911a7aa52ed1e39b0f688"}];
const GENERIC_ORACLE = [{"args":["smooth","infantry",1,"hold"],"hash":"252b6c53e8ec736e631c4a3f11585f1050dabca7eb69ccf1f09157f1ffa19596","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":44,"unitDraws":2256,"shots":22},{"args":["smooth","infantry",1,"march"],"hash":"7f1fff7c2635f8f532761bb37c299a2524ad2f1bce23b9e68efe6cb195d9d708","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":42,"unitDraws":2199,"shots":21},{"args":["smooth","infantry",1,"attack"],"hash":"70f98d9a81ee23f6ec8c82650528653a7d4f1200c7fef58359b25735a64ab58b","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":2,"unitDraws":101,"shots":1},{"args":["smooth","infantry",1,"charge"],"hash":"a895d30a5dd59043b0ca8deae64bb38f02ec15e6563bd2829f4b5fbd4dc81e28","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":61,"unitDraws":2689,"shots":26},{"args":["smooth","infantry",1,"fightMarch"],"hash":"74cef5b0f63d61f66a02012e4a82b951139f3a7785af025d2d775ab8f46ef164","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1127,"shots":11},{"args":["smooth","infantry",1,"quietMarch"],"hash":"b12fdee739fb15f0b186aac6843afa0e84605c293d8c6742b84aac50be17c67e","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["smooth","infantry",1,"direct"],"hash":"223a0974e19af7036511c786bf51dc8b6fcf56cc81ff000bae6c66673b05699b","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":44,"unitDraws":2256,"shots":22},{"args":["smooth","infantry",72,"hold"],"hash":"62800a286461fecd699b22088f30a68495bd33a442778f86297f1b5a6a689e1a","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":44,"unitDraws":2287,"shots":22},{"args":["smooth","infantry",72,"march"],"hash":"2aedfb689b8040056d5a2b8e3e4d14ab095e4cd32dbcceb9ca61bd04ba723a95","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":961,"shots":9},{"args":["smooth","infantry",72,"attack"],"hash":"b3283c783d9e0af23e6adbcdc6d94291b71a2bf179c981e06c0f188a8887f9f0","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":2,"unitDraws":107,"shots":1},{"args":["smooth","infantry",72,"charge"],"hash":"9e45dc247070457a499d354a8cf95ea947535d54690f16c151a82fd91af32506","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":56,"unitDraws":1365,"shots":13},{"args":["smooth","infantry",72,"fightMarch"],"hash":"a5a04db3df10beff192916eb67d68951352ba9ef00ebf433fae03735c1548612","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1142,"shots":11},{"args":["smooth","infantry",72,"quietMarch"],"hash":"be0186705b83c5b9eb215b834b1a4f7d469c0f18ce132ab4c817cd1500fc7d69","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["smooth","infantry",72,"direct"],"hash":"7dc0e677ec7f5617befb703a7483da1ec395fdfea3687d48f50ec2ac7ea2d599","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":46,"unitDraws":2384,"shots":23},{"args":["smooth","infantry",902,"hold"],"hash":"a403d789042fa601f10430e48fa68d9b55bb3545ccb838b09e3f87eea214fc65","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":46,"unitDraws":2360,"shots":23},{"args":["smooth","infantry",902,"march"],"hash":"aa48c972fe13c3e791354827abdf350eb235b72de5380f9bd03ed74d6ad68839","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":42,"unitDraws":2207,"shots":21},{"args":["smooth","infantry",902,"attack"],"hash":"a10936a5f768b41fda28f4550f9471b53a41eda248e84554abcc2625d641cd06","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":2,"unitDraws":101,"shots":1},{"args":["smooth","infantry",902,"charge"],"hash":"8e8607c4e0343fb3b41c9e170cf6d080e039c875cb12b30f2c42844e96c7877e","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":64,"unitDraws":2661,"shots":26},{"args":["smooth","infantry",902,"fightMarch"],"hash":"bf44822d774e24f1016698bd56f17d14969914c3387829e0ece7d2d1e8374d51","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1144,"shots":11},{"args":["smooth","infantry",902,"quietMarch"],"hash":"0cc12fda45ea275ec8aa8c78f2e66f8135da22c05eeb732318b60c3e98cfa8b1","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["smooth","infantry",902,"direct"],"hash":"b98a320cddad3d5f781de8eb5903da9a5be5252584900258eda827e61ed55671","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":46,"unitDraws":2360,"shots":23},{"args":["rifled","infantry",1,"hold"],"hash":"16696a90d0406c304baca4fe23706926a5e18562055320593516ca7339492a48","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":44,"unitDraws":2252,"shots":22},{"args":["rifled","infantry",1,"march"],"hash":"a71af319bc73105ce3f7eff9f787a477b8ac74fd1a2b9e41a6cf30768b59caea","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":42,"unitDraws":2204,"shots":21},{"args":["rifled","infantry",1,"attack"],"hash":"4f5b1406486a585584a7c8e4fc017fbf07674840e367e5eafcef7944975a7708","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":4,"unitDraws":203,"shots":2},{"args":["rifled","infantry",1,"charge"],"hash":"7a3777d1ab22c87839ae583dbafe72b18f6ca0a1dfa680c6b145b8b17eb3bdcd","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":61,"unitDraws":2676,"shots":26},{"args":["rifled","infantry",1,"fightMarch"],"hash":"0c27d92787d135ec073a2db418bbda1ec3d5273f3df0bfcc6ac17410b69ed7d3","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1131,"shots":11},{"args":["rifled","infantry",1,"quietMarch"],"hash":"c5a15e00413eca9dbd3902ea169149d7e55f6bc95e53b7f45546fd1abe234475","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["rifled","infantry",1,"direct"],"hash":"226cc68443064fc5ce39d66cfb93915fd829e1630f41f5ebc79fe87c4d616cec","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":44,"unitDraws":2252,"shots":22},{"args":["rifled","infantry",72,"hold"],"hash":"fab0ea5adec92251a5b3cfe27bc9ea595ae844130007a82fb4e0db4e50acd0b1","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":44,"unitDraws":2282,"shots":22},{"args":["rifled","infantry",72,"march"],"hash":"9584fccb9e5fd7c427e776ed794f222ea6199b7baedd3cfb0f561b39df443070","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":961,"shots":9},{"args":["rifled","infantry",72,"attack"],"hash":"b2cb57f5409ed3bfd1cbb073b020d794587f9f06bd3c2af811ea7162e9a5a481","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":4,"unitDraws":210,"shots":2},{"args":["rifled","infantry",72,"charge"],"hash":"514b2aca768714db86c6b73c814834410376e698079b2eaa2c5fc8f5c93e3af7","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":56,"unitDraws":1375,"shots":13},{"args":["rifled","infantry",72,"fightMarch"],"hash":"a31ce4e84d74a13c0f7130e59017c18a952e0ca7becce61cfa4cefa4a13bcf01","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1143,"shots":11},{"args":["rifled","infantry",72,"quietMarch"],"hash":"c079bea40aa05dee6d1fd392fafde4926f5bb4c2ffa4f5c9aec01406bdbc0ff9","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["rifled","infantry",72,"direct"],"hash":"632c7501cdf264ca9526847934d7e88d2a0cb19976daccd560fd72dd063f71ae","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":46,"unitDraws":2378,"shots":23},{"args":["rifled","infantry",902,"hold"],"hash":"a5e63ce8c9f5285ce2e8482132f25057afe9745d346f980c23b1b8ed84494877","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":43,"unitDraws":2155,"shots":21},{"args":["rifled","infantry",902,"march"],"hash":"2880b6a2d96d24835d18752532bc201109dc8be3fbb1ecdaa3200edc15083b61","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":42,"unitDraws":2210,"shots":21},{"args":["rifled","infantry",902,"attack"],"hash":"38717e0a8b899502f33b7eec4884d37f0871241e7fec50f7365b634c7812e9f1","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":4,"unitDraws":206,"shots":2},{"args":["rifled","infantry",902,"charge"],"hash":"4a566cc5223d55661672e10c50b6fcb9d454609ce9cd17a6fc908c85a11776b9","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":64,"unitDraws":2668,"shots":26},{"args":["rifled","infantry",902,"fightMarch"],"hash":"375de12b60cc011f9cd3de045c6e8634b033cee105318edc95b0b6b6f9350323","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1150,"shots":11},{"args":["rifled","infantry",902,"quietMarch"],"hash":"39700132bcec54be88bf5819f3ad07f156341006ee7bbeddb6aeb94d4a008011","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["rifled","infantry",902,"direct"],"hash":"bf02412e26fa8bfa14dd05df7b4aede8d145753a3ff9068aaf90d17190319cac","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":43,"unitDraws":2155,"shots":21},{"args":["smbart","artillery",1,"hold"],"hash":"ffe009020787c0fdb7c045b9f970aa13505ddc373ce75b9497e569f637702c1d","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":38,"unitDraws":1056,"shots":19},{"args":["smbart","artillery",1,"march"],"hash":"5fdc889f307be078ead55c9747a0fed77d5d157ebf95e3c2234870bcae730db8","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":28,"unitDraws":1482,"shots":14},{"args":["smbart","artillery",1,"attack"],"hash":"d9ec461501c800e4ec132412893f18e622b732e34f4bb924504ad1fc551945f7","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":16,"unitDraws":0,"shots":8},{"args":["smbart","artillery",1,"charge"],"hash":"9c3e7a8494200ecf594acf7a8569866cef6841a54769cf6f7438921152a4e912","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":56,"unitDraws":1815,"shots":21},{"args":["smbart","artillery",1,"fightMarch"],"hash":"51a675730d600c586a48d0adf9fc2b3c6ad562dcf46639ba410cbca582d22f9d","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":525,"shots":9},{"args":["smbart","artillery",1,"quietMarch"],"hash":"02bbc5baa39f640a343405d5fbac71b904c1ac56dd474064363c058995abb43a","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["smbart","artillery",1,"direct"],"hash":"f421e2990e9952c025ffe5fba75b09a41c4aa147014b3da46a748d90ed2f3e53","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":38,"unitDraws":1056,"shots":19},{"args":["smbart","artillery",72,"hold"],"hash":"3396f0960a783d7960d1830b139b6aaca4011862a0a384a380b6767ca7148752","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":36,"unitDraws":1044,"shots":18},{"args":["smbart","artillery",72,"march"],"hash":"fc87b02ec64b10860d317443a9afa055cddefa8b95386042062979a205b91726","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":6,"unitDraws":326,"shots":3},{"args":["smbart","artillery",72,"attack"],"hash":"903bfaae22d2b6bd04b7ad8544c6aa3a47d0551e84b0b446e57e5a01ac460c0d","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":16,"unitDraws":0,"shots":8},{"args":["smbart","artillery",72,"charge"],"hash":"f95f9384d919c5546d50fd080fe276fe8036d64ec4c464861406345646e54c32","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":52,"unitDraws":1165,"shots":19},{"args":["smbart","artillery",72,"fightMarch"],"hash":"16047a53ddff35678bf0d22612b053bdc01a85e2b09732253b9fe0588a82b1e5","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":532,"shots":9},{"args":["smbart","artillery",72,"quietMarch"],"hash":"dd7c8f82bce1d4bcfbec39eac2a509e5e9a1996444017b671b11e78f6a1e0b7e","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["smbart","artillery",72,"direct"],"hash":"950a282eaa7533281394716b881c4b1114731342c4f3b7a47b51593ebf8266ea","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":38,"unitDraws":1044,"shots":19},{"args":["smbart","artillery",902,"hold"],"hash":"b4fc9c0e6ca118706a476c879ba500c1712406a32577fbb7c715588a7e410697","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":40,"unitDraws":1158,"shots":20},{"args":["smbart","artillery",902,"march"],"hash":"ce3245bdbaddb0da71741e615fd5d2c8ee605d5d9b6b1cccc447174e3604b346","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":28,"unitDraws":1523,"shots":14},{"args":["smbart","artillery",902,"attack"],"hash":"32675222b7b36e9ec91658230a59623b898d47ba54b6bdeb3f5e1abebace9d17","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":0,"shots":9},{"args":["smbart","artillery",902,"charge"],"hash":"72cc8e4fbcaead1e6301234f1ba1a0738e4f4f8cc65b22f55672a45f46a00da9","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":51,"unitDraws":1657,"shots":17},{"args":["smbart","artillery",902,"fightMarch"],"hash":"c09c8399eed3b88ffe9dabbb00cbce0d23803dcbae3dda441a9c4b69cbfc5e03","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":20,"unitDraws":653,"shots":10},{"args":["smbart","artillery",902,"quietMarch"],"hash":"e7d1372774ac2c510a4353e8f104b24435d84c695f0081bf04a2cbc827ee6cd8","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["smbart","artillery",902,"direct"],"hash":"581a93187582b2749f9262bc13bb3f49533ce72fb6347e9c2241f01e1dc47b2c","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":40,"unitDraws":1158,"shots":20},{"args":["parrott","artillery",1,"hold"],"hash":"cc5330d90bd3741e3208e47af2dcabdb23275039a4c87d7445d3b700f9042d8f","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":38,"unitDraws":1048,"shots":19},{"args":["parrott","artillery",1,"march"],"hash":"aa2241eaa003260d94ef24d0021afcbafd089f92e32c3516483118fc29700570","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":28,"unitDraws":1482,"shots":14},{"args":["parrott","artillery",1,"attack"],"hash":"0a841dfdf583c9b49adefc69b9b0f78e27322cd35409363fad0bb58ef3f0714b","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":16,"unitDraws":0,"shots":8},{"args":["parrott","artillery",1,"charge"],"hash":"f42a95222338568bc1042b5db4710ba821031b5efcafa0c90357df1398bfc926","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":56,"unitDraws":1810,"shots":21},{"args":["parrott","artillery",1,"fightMarch"],"hash":"53894bb5c4e64b435e20327a77de1cbd0ea6dba13cbde679d347505b993201eb","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":530,"shots":9},{"args":["parrott","artillery",1,"quietMarch"],"hash":"1c619607c251c6e93663c6bd1dfda0fae9af3fc3a7306f7779ebd35b21b69f1b","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["parrott","artillery",1,"direct"],"hash":"7c12b3c253ca37f371805cc56a88e64d8fa5402d9def2ef0f6e9ade778ac901d","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":38,"unitDraws":1048,"shots":19},{"args":["parrott","artillery",72,"hold"],"hash":"13808dd1d8e0978a377176f2f603b02511faffec69418b402820ffab7d7f8842","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":36,"unitDraws":1043,"shots":18},{"args":["parrott","artillery",72,"march"],"hash":"03d78b16c7d0383d57832a7220ffdac5ad9b00125c1c541b2bc5086913665b0b","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":6,"unitDraws":326,"shots":3},{"args":["parrott","artillery",72,"attack"],"hash":"07fc2a5f0e979058923dc0b714d23790e575dde4c3336207d8ec850157b88194","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":16,"unitDraws":0,"shots":8},{"args":["parrott","artillery",72,"charge"],"hash":"46a0f23765a097dbdd7d4a816a3ba500a4ff1349b7860e789a6290530e3e346e","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":52,"unitDraws":1165,"shots":19},{"args":["parrott","artillery",72,"fightMarch"],"hash":"0437f2cf068def7da71dbfc7225ba640a7c9623459bb38b4f49351ca8664600c","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":530,"shots":9},{"args":["parrott","artillery",72,"quietMarch"],"hash":"064e1b64eee11645ef1aedf1282a2bf4d1d822efcde6db2a84250a2f270141e8","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["parrott","artillery",72,"direct"],"hash":"c952266e24108ab811c4853989da8ee34393e42c2e540a1201f66271a9695c07","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":38,"unitDraws":1047,"shots":19},{"args":["parrott","artillery",902,"hold"],"hash":"a92c38eb761fabc998d7512d31fecda5c0703a72a9396501a5817ac5d9d72d2c","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":37,"unitDraws":860,"shots":17},{"args":["parrott","artillery",902,"march"],"hash":"0ab4b49f04a41fb89b5baa06363f41aa8bfa4c77b7027d31bb977245d8b10f73","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":28,"unitDraws":1523,"shots":14},{"args":["parrott","artillery",902,"attack"],"hash":"c1afee77922faab90ad551f4773a7f9cb7ff8480b5923480bb29d084b7732b80","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":4,"shots":9},{"args":["parrott","artillery",902,"charge"],"hash":"4a2255dd93dbf52ee91a92c20311a73fa7d17c365ccdac7146f604969fd1eb18","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":51,"unitDraws":1657,"shots":17},{"args":["parrott","artillery",902,"fightMarch"],"hash":"a37c29cd631c95996a78b9b8cd4b88c3efe417c410ba267c4b0238957c97ee3f","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":20,"unitDraws":650,"shots":10},{"args":["parrott","artillery",902,"quietMarch"],"hash":"e5a7f30e967b65ac05066c7ae39bb9753fd59cbca24c904a2c126eea4c7a015d","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["parrott","artillery",902,"direct"],"hash":"6664ff945d8011e5ec393219461a86f9c68be068fcb02b670fc9cd0558ec3168","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":37,"unitDraws":860,"shots":17},{"args":["napoleon","artillery",1,"hold"],"hash":"7d69b2a096758add8757b855a97dfc047d7cfa1fb2a741e4c2da90a528b63063","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":38,"unitDraws":1048,"shots":19},{"args":["napoleon","artillery",1,"march"],"hash":"3e97b4216a68bd49ca86941152db7a6c684482a29af3199bcb060fa8a60d2a53","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":28,"unitDraws":1482,"shots":14},{"args":["napoleon","artillery",1,"attack"],"hash":"37d85c9712c61a932926a59853e690676dfdc7f54e6b519f8325f36be554b421","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":16,"unitDraws":0,"shots":8},{"args":["napoleon","artillery",1,"charge"],"hash":"becf34ccde8daadb822c070284a656b44838678203c83e13ef291943fc56dc0b","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":56,"unitDraws":1810,"shots":21},{"args":["napoleon","artillery",1,"fightMarch"],"hash":"6b0cba8e1c9e2ce5b01fd428abf3743c357788e1c8c1226c8184943db0f29ef5","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":529,"shots":9},{"args":["napoleon","artillery",1,"quietMarch"],"hash":"84e644c4ccd78414766475f02f066e10e451d4927f796763d1adaf041f3addeb","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["napoleon","artillery",1,"direct"],"hash":"b8784d182faef97317fc741f813bcb59f0e789d4b8446ded26a8e70a37bab329","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":38,"unitDraws":1048,"shots":19},{"args":["napoleon","artillery",72,"hold"],"hash":"03a8829fd8b6aed5b06bd9a9f0fc0e07babd0707529d9981d33612fc10fa7a72","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":36,"unitDraws":1043,"shots":18},{"args":["napoleon","artillery",72,"march"],"hash":"6a3a34262f6427aa0e010db73a4f36a73bb74e2987305f096da95721648c80a9","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":6,"unitDraws":326,"shots":3},{"args":["napoleon","artillery",72,"attack"],"hash":"579b0d91f2c7e4122971c49bd57810429a4e1eeb551327588b1fc1acadf6fd02","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":16,"unitDraws":0,"shots":8},{"args":["napoleon","artillery",72,"charge"],"hash":"2544784ff0db31b4be8c780e307e2f19f3d030a80740168ee127d12d0b5f65dc","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":52,"unitDraws":1165,"shots":19},{"args":["napoleon","artillery",72,"fightMarch"],"hash":"d72ce935b98990818baee8984eace9adadbd8f2715f6423f341926de740e0975","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":530,"shots":9},{"args":["napoleon","artillery",72,"quietMarch"],"hash":"c1b9196ffcea5ea8cd99ad8d6a8e8e49a89d0f145cdcac0fdaab91fec11b84ed","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["napoleon","artillery",72,"direct"],"hash":"3c50a756d872c67d49c920206d51d10025b2a12c048581e6ef724be8340cc128","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":38,"unitDraws":1043,"shots":19},{"args":["napoleon","artillery",902,"hold"],"hash":"c84ceea9790713f962da49ed760c6c063e59319a723293790d76f2e48ee0ee85","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":37,"unitDraws":959,"shots":18},{"args":["napoleon","artillery",902,"march"],"hash":"3be80576c6ffe81d287dc6c1d46428ebb2c4a92e02bfa691615ae9b8f35b5542","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":28,"unitDraws":1523,"shots":14},{"args":["napoleon","artillery",902,"attack"],"hash":"85b0727c53ab15374bdb3e1ead9737f44641eeb78176cf373073a90bdd7e9a75","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":4,"shots":9},{"args":["napoleon","artillery",902,"charge"],"hash":"65aa75528bfedb94ee02520468e88438e6001ef17a13a5cd78952f38a8171ab9","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":51,"unitDraws":1657,"shots":17},{"args":["napoleon","artillery",902,"fightMarch"],"hash":"578482a2b8eec182062f19d7a98d3c00d5716a97f40de944abec94a128b8d395","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":20,"unitDraws":652,"shots":10},{"args":["napoleon","artillery",902,"quietMarch"],"hash":"8c8e48c3bef9f747f09cb38ee9b3b2e74b718b768a8d1dc7f6784fe674d9b183","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":8,"unitDraws":0,"shots":4},{"args":["napoleon","artillery",902,"direct"],"hash":"3027dc62dcb07f68be30783c14308fc7954e82492eed5db1795efd62a1c76077","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":37,"unitDraws":959,"shots":18},{"args":["unknown","infantry",1,"hold"],"hash":"e38a770b444ac635dd65dfbfde7ed371245deb4b284db8b5dbd7e3d0549faaca","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":44,"unitDraws":2256,"shots":22},{"args":["unknown","infantry",1,"march"],"hash":"69aefcd47cc078b06bc5223aab6261cc760cccbfc3ae97435972f708e6453c93","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":42,"unitDraws":2199,"shots":21},{"args":["unknown","infantry",1,"attack"],"hash":"f1442543b836f0a5c7ad8cde0a58a6a9a0a3ac4fd5f2cd06dc6fc3c5414b4b42","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":2,"unitDraws":101,"shots":1},{"args":["unknown","infantry",1,"charge"],"hash":"d7cf98b4dd67b7fc27a77aa2b8585af0863ca9b2357c353b71c9fea91b7748ca","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":61,"unitDraws":2689,"shots":26},{"args":["unknown","infantry",1,"fightMarch"],"hash":"a89c04d4e042e51ea1b1e61a9ede2ba7939e1a7b98b306d79c07bfb8dee5613a","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1127,"shots":11},{"args":["unknown","infantry",1,"quietMarch"],"hash":"a6623d44e49e874c63cd7b288021199cc85572153294e23a90af2f1ef250195d","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["unknown","infantry",1,"direct"],"hash":"fa5aa97baafac9e048560fadb1b7553dd79721c1248dd789e4d899a5fc50c8ed","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":44,"unitDraws":2256,"shots":22},{"args":["unknown","infantry",72,"hold"],"hash":"052290713e91cab4526d7b3826795a8f6b8d0d9d5157e1a54d8ed6904e077451","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":44,"unitDraws":2287,"shots":22},{"args":["unknown","infantry",72,"march"],"hash":"9ab84ed63048eb1489ce12c7f34c2affb99a36d473b17031a4fe3dc468d2991e","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":18,"unitDraws":961,"shots":9},{"args":["unknown","infantry",72,"attack"],"hash":"7f08ff538292fe1c59302ba3967f1ecad049e8185afcb51b8206f35c07018f88","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":2,"unitDraws":107,"shots":1},{"args":["unknown","infantry",72,"charge"],"hash":"6554b7aeed38434210ebd8cf5e2797c57bccf801baa8264dfeceb1cf025a6d48","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":56,"unitDraws":1365,"shots":13},{"args":["unknown","infantry",72,"fightMarch"],"hash":"202408601195b2dd97d7a4c989bd64f1a9a40774e70b55cc4d6e2df7dee20c5e","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1142,"shots":11},{"args":["unknown","infantry",72,"quietMarch"],"hash":"c3decb7da6ec1985a939bb3fb55f7389021c314a82c111e738902ed2d3c2a382","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["unknown","infantry",72,"direct"],"hash":"214340817e824ed6a1c130c1a1e0d3b2ec31f55efe6c019462135bf0a4b6dca1","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":46,"unitDraws":2384,"shots":23},{"args":["unknown","infantry",902,"hold"],"hash":"f6085a58f9936c17e587d08dc6331628f1bf59549e9bb8fde4d8f8121e3eeeb7","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":46,"unitDraws":2360,"shots":23},{"args":["unknown","infantry",902,"march"],"hash":"08643f0987c4589f174144ed085c6b07b05420937bede75f0e5af84d77782144","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":42,"unitDraws":2207,"shots":21},{"args":["unknown","infantry",902,"attack"],"hash":"a5ed51a0c8af141aadcea8cf57940cf6193d14fb546ff6d8456c28f09270df16","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":2,"unitDraws":101,"shots":1},{"args":["unknown","infantry",902,"charge"],"hash":"e28c6ca3f312cb50fd1cfa3b0f23a494f380071f5241ff0a93e478ce14f5dc4a","halted":false,"resumed":false,"arrived":false,"directShots":0,"combatDraws":64,"unitDraws":2661,"shots":26},{"args":["unknown","infantry",902,"fightMarch"],"hash":"6707941f7304e2cfe1a025a46945c0c2caf39e859efde0bc0e6f7b1b7069a61c","halted":true,"resumed":true,"arrived":false,"directShots":0,"combatDraws":22,"unitDraws":1144,"shots":11},{"args":["unknown","infantry",902,"quietMarch"],"hash":"ac3c226acd9ed16a71e04c195dd8eec8d7b7caab6694927013a5e9e378686822","halted":false,"resumed":false,"arrived":true,"directShots":0,"combatDraws":0,"unitDraws":0,"shots":0},{"args":["unknown","infantry",902,"direct"],"hash":"a4f70404cdf09d91ad8e78ab0cb6bd9a16e23643a77dc6b58f439648636f8713","halted":false,"resumed":false,"arrived":false,"directShots":1,"combatDraws":46,"unitDraws":2360,"shots":23}];
function genericReplay(weapon,type,seed,mode){
 const previous={...RULES};
 try{
  Object.assign(RULES,{moveOrder:mode==='march'?'march':'fight',fireEffect:[0.5,1,2][seed%3],moraleLoss:1.15,fatigueGain:0.8,marchSpeed:1.1});
  const terrain={half:3000,heightAt:(x,z)=>Math.sin(z/100)*2,slopeAt:()=>0.015,inBounds:()=>true};
  const dist=mode==='quietMarch'?1000:mode==='attack'?500:mode==='charge'?18:75;
  const make=(id,side,x,z,w,t)=>new Unit({id,side,type:t,name:id,men:t==='artillery'?180:800,guns:t==='artillery'?6:0,weapon:w,xp:2,x,z,facing:side==='US'?0:Math.PI}, {},terrain,seed+id.length);
  const a=make('a','US',0,0,weapon,type),b=make('enemy','CS',0,dist,'rifled','infantry'),c=make('other','CS',70,dist+65,'smooth','infantry');
  const initial=[a,b,c].map(u=>JSON.parse(JSON.stringify({id:u.id,type:u.type,weapon:u.weapon,guns:u.guns,menMax:u.menMax,xp:u.xp,ammo:u.ammo,morale:u.morale,reload:u.reload,facing:u.facing,figures:u.figures})));
  const units=[a,b,c],random=makeRng(seed),combatDraws=[],unitDraws={},effects=[];
  for(const u of units){const original=u.rnd;unitDraws[u.id]=[];u.rnd=()=>{const v=original();unitDraws[u.id].push(v);return v;};for(const f of u.figures)f.clip='aim';}
  const combat=new Combat({units,terrain,coverAt:(x,z)=>({value:z>80?1.7:1,kind:z>80?'woods':'open'}),fallen:{},rnd:()=>{const v=random();combatDraws.push(v);return v;},fx:{volley:(u,m)=>effects.push([u.id,m]),boom:(u,t,c)=>effects.push([u.id,t.id,c])}});
  const game=Object.assign(Object.create(Game.prototype),{units,terrain,combat,playerSide:'US',selection:[a],selected:a,orders:0,scenario:{},emit(){}});
  a.unlimbered=type==='artillery'&&mode!=='march';a.ammo=83;a.fatigue=23;b.morale=38;b.fatigue=65;c.holdFire=seed===72;
  if(mode==='attack')game.order(a,{type:'attack',target:b});
  if(['march','fightMarch','quietMarch'].includes(mode))game.order(a,{type:'move',points:[[0,0],[0,mode==='quietMarch'?120:600]],endFacing:0});
  if(mode==='charge')game.order(a,{type:'charge',points:[[0,0],[0,dist]],target:b});
  const manager=new EntityManager();for(const u of units)manager.add(u.vehicle);
  const state=()=>units.map(u=>({id:u.id,x:u.x,z:u.z,men:u.men,ammo:u.ammo,morale:u.morale,fatigue:u.fatigue,reload:u.reload,shots:u.shots||0,kills:u.kills||0,state:u.state,target:u.target?.id||null,order:JSON.parse(JSON.stringify({...u.order,target:u.order.target?.id})),path:u.path?.map(p=>p.slice())??null,followActive:u.follow.active,resumeT:u.resumeT,halt:u.haltCount,engaged:u.engaged,formation:u.formation,range:combat.range(u),eff:game.effRange(u),facing:u.facing,goalFacing:u.goalFacing,velocity:[u.vehicle.velocity.x,u.vehicle.velocity.z],unlimbered:u.unlimbered}));
  const direct=mode==='direct'?(combat.volleyAt(a,b,0.25),state()):null;
  const history=[];
  for(let n=1;n<=240;n++){if(mode==='fightMarch'&&n===121){b.vehicle.position.z=2000;c.vehicle.position.z=2200;}const dt=0.25;manager.update(dt);for(const u of units)u.move(dt,u.side==='US'?-2960:2960);if(a.order.type==='attack')game.attackStep(a);combat.step(dt,n*dt);history.push(state());}
  const figures=units.map(u=>[u.id,u.figures.map(f=>({alive:f.alive,dying:f.dying,front:f.front,dieYaw:f.dieYaw,fireAt:f.fireAt,lx:f.lx,lz:f.lz,rank:f.rank}))]);
  return {hash:digest({initial,direct,history,figures,combatDraws,unitDraws,effects,log:combat.log.map(v=>({kind:v.kind,text:v.text,unit:v.unit.id})),orders:game.orders}),halted:history.some(s=>s[0].engaged),resumed:history.some((s,i)=>i>=120&&s[0].halt>0&&!s[0].engaged&&s[0].followActive),arrived:!a.follow.active&&Math.hypot(a.x,a.z-120)<22,directShots:direct?.[0].shots??0,combatDraws:combatDraws.length,unitDraws:Object.values(unitDraws).reduce((n,v)=>n+v.length,0),shots:units.reduce((n,u)=>n+(u.shots||0),0),terminal:state()};
 }finally{Object.assign(RULES,previous);}
}

function verifyGeneric(replay = genericReplay) {
  assert.equal(GENERIC_ORACLE.length,126,'nonempty historical fixture');
  let combatDraws=0, unitDraws=0, halted=0, resumed=0, arrived=0, direct=0, gunSamples=0;
  for(const c of GENERIC_ORACLE){
    const {terminal,...actual}=replay(...c.args);
    assert.deepEqual(actual, Object.fromEntries(Object.entries(c).filter(([k])=>k!=='args')), 'generic replay '+c.args.join('/'));
    combatDraws+=actual.combatDraws;unitDraws+=actual.unitDraws;
    if(c.args[3]==='fightMarch'){halted+=+actual.halted;resumed+=+actual.resumed;}
    if(c.args[3]==='quietMarch')arrived+=+actual.arrived;
    if(c.args[3]==='direct')direct+=+(actual.directShots===1);
    if(c.args[1]==='artillery'&&terminal[0].shots>0)gunSamples++;
  }
  assert.deepEqual([halted,resumed,arrived,direct,gunSamples,combatDraws,unitDraws],[18,18,18,18,54,3606,136580]);
  console.log('GENERIC ORACLE OK (126/126; 18 halts/resumes, 18 arrivals, 18 direct, 54 gun samples; 3606 Combat/136580 Unit draws)');
}
// A precedes actual named combat B; A2 follows every named test/control to expose leaked settings.
verifyGeneric();

const { equipmentProfile } = await import('../src/sim/equipment.js');
const { ARMS, PRACTICE_ARMS, UNIQUES, CONDITIONS, itemDef } = await import('../src/reward/data.js');
const { TUNING } = await import('../src/reward/model.js');
const { Input } = await import('../src/ui/input.js');
const { ArrowLayer } = await import('../src/ui/arrows.js');
const THREE = await import('three');
const definitions = [...ARMS, ...PRACTICE_ARMS, ...UNIQUES];
const terrain = { half: 3000, heightAt: () => 0, slopeAt: () => 0, inBounds: () => true };
const baseDef = { id: 'a', side: 'US', type: 'infantry', name: 'Fictional test brigade', men: 800, xp: 2, x: 0, z: 0, facing: 0, weapon: 'smooth' };
const gear = (id = 'm1842', conditionId = 'serviceable') => ({ uid: 'test-' + id, itemId: id,
  tier: itemDef(id).tier, conditionId, from: 'Fictional test issue', source: 'capture' });
// No default equipment argument: explicit undefined must reach runtime validation unaltered.
function make(equipment, extra = {}) {
  const known = equipment && definitions.some((d) => d.id === equipment.itemId);
  const type = known ? itemDef(equipment.itemId).arm : 'infantry';
  return new Unit({ ...baseDef, type, guns: type === 'artillery' ? 6 : 0, ...extra, equipment }, {}, terrain, 72);
}
function fixture(equipment = gear(), extra = {}) {
  const u = make(equipment, extra), t = new Unit({ ...baseDef, id: 't', side: 'CS', men: 2000, z: 45, facing: Math.PI }, {}, terrain, 90);
  const units = [u, t], effects = [], combat = new Combat({ units, terrain, coverAt: () => ({ value: 1, kind: 'open' }),
    fallen: {}, rnd: () => 0.5, fx: { volley: (a, m) => effects.push(['volley', a.id, m.length]), boom: (a, b, c) => effects.push(['boom', a.id, c]) } });
  const game = Object.assign(Object.create(Game.prototype), { units, terrain, combat, selected: u, selection: [u],
    playerSide: 'US', orders: 0, scenario: {}, emit() {} });
  u.unlimbered = u.type === 'artillery'; u.target = t; t.holdFire = true;
  return { u, t, combat, game, effects };
}
function volley(equipment, opts = {}) {
  const f = fixture(equipment), { u, t, combat } = f;
  u.fatigue = opts.fatigue ?? 0; u.ammo = opts.ammo ?? 100; u.morale = opts.morale ?? 78;
  t.cover = opts.cover ?? 1; t.vehicle.position.z = opts.distance ?? 45;
  const previous = RULES.fireEffect;
  try {
    RULES.fireEffect = opts.effect ?? 1;
    combat.volleyAt(u, t, 10, opts.moving ?? false, opts.period);
    return { loss: u.kills, ammo: u.ammo, shots: u.shots, reload: u.reload, underFire: t.underFire, effects: f.effects };
  } finally { RULES.fireEffect = previous; }
}
function cadence(equipment, opts = {}) {
  const { u, t, combat } = fixture(equipment);
  u.fatigue = opts.fatigue ?? 0; u.reload = 0;
  if (opts.moving) { u.orderMove([[0, 0], [0, 300]], { endFacing: 0 }); u.vehicle.velocity.z = 2; }
  if (opts.run) u.run = true;
  if (opts.hold) u.holdFire = true;
  if (opts.limber) u.unlimbered = false;
  if (opts.charge) u.order.type = 'charge';
  if (opts.melee) u.melee = true;
  if (opts.routing) u.state = 'routing';
  const previous = RULES.moveOrder;
  try {
    RULES.moveOrder = 'march';
    for (let n = 1; n <= 240; n++) combat.fireStep(u, 0.25, n * 0.25);
    return { shots: u.shots || 0, loss: u.kills || 0, ammo: u.ammo, reload: u.reload, men: t.men };
  } finally { RULES.moveOrder = previous; }
}
function changedNumber(id, key, value, fn) {
  const d = itemDef(id), previous = d[key].v;
  try { d[key].v = value; return fn(); } finally { d[key].v = previous; }
}
const api = { profile: equipmentProfile, make, fixture, volley, cadence, replay: genericReplay,
  construct: (def, Class = Unit) => new Class(def, {}, terrain, 72) };
const broken = (changes) => ({ ...api, ...changes });
const changedFixture = (change) => broken({ fixture: (...args) => { const f = fixture(...args); change(f); return f; } });
// Every test uses named AssertionErrors. Harness/import failures never count as rejecting controls.
function assertions(name) {
  const label = (s) => name + ': ' + s;
  return {
    ok: (v, s) => assert.ok(v, label(s)),
    eq: (a, b, s) => assert.deepEqual(a, b, label(s)),
    near: (a, b, s, tolerance = 1e-8) => assert.ok(Number.isFinite(a) && Math.abs(a - b) <= tolerance, label(s) + ` expected ${b}, got ${a}`),
    refuses: (fn, s) => { let error; try { fn(); } catch (e) { error = e; }
      assert.ok(error instanceof Error && /^Equipment:/.test(error.message), label(s)); },
  };
}
const tests = [
  ['catalogue-115', (a, c) => {
    c.eq([definitions.length, CONDITIONS.length], [23, 5], 'complete catalogue'); let count = 0;
    for (const d0 of definitions) for (const cond of CONDITIONS) {
      const def = itemDef(d0.id), it = gear(d0.id, cond.id), p = a.profile(it, def.arm), u = a.make(it);
      c.eq(p.item, it, 'instance identity'); c.eq(p.definition, def, 'full definition'); c.eq(p.condition, cond, 'full condition');
      c.near(p.rangeMetres, def.range.v * 0.9144, 'yard conversion');
      c.near(p.reloadSeconds, 60 / (def.rate.v * 4), 'RPM conversion');
      c.near(p.powerMultiplier, (def.arm === 'artillery' ? 1.6 / 30 : 1 / 28) * def.power.v * (def.accuracy.v / 50) * cond.mult, 'shared game calibration');
      c.eq(u.equipment, it, 'actual Unit identity'); c.near(u.equipmentProfile.rangeMetres, p.rangeMetres, 'actual Unit profile');
      c.ok(a.volley(it).loss > 0, 'actual nonempty shared combat sample'); count++;
    }
    c.eq(count, 115, 'nonempty all-definition-condition resolution');
    console.log('CATALOGUE CONDITIONS OK (115/115 actual Unit/profile/volley cases)');
  }, broken({ profile: (...args) => ({ ...equipmentProfile(...args), rangeMetres: 1 }) })],
  ['identity-provenance-immutable', (a, c) => {
    const it = gear('u-lucky-seven', 'worn'), before = JSON.stringify(it), u = a.make(it), p = u.equipmentProfile;
    c.eq(JSON.stringify(it), before, 'input unchanged'); c.ok(u.equipment !== it, 'clone identity'); c.eq(u.equipment, it, 'identity fields');
    for (const v of [u.equipment, p, p.definition, p.definition.power, p.definition.special, p.condition, p.provenance]) c.ok(Object.isFrozen(v), 'deep freeze');
    c.eq(p.provenance, { range: 'old-data', rate: 'old-data', accuracy: 'old-data', power: 'placeholder', calibration: 'game choice',
      gameItem: true, gameModifier: true, specialsImplemented: false }, 'honest provenance and special debt');
    c.eq(p.definition.special, itemDef(it.itemId).special, 'preserve special metadata');
    const binding = Object.getOwnPropertyDescriptor(u, 'equipmentProfile'); c.eq([binding.writable, binding.configurable], [false, false], 'immutable unit binding');
    it.uid = 'changed'; it.from = 'changed'; c.eq(u.equipment.uid, 'test-u-lucky-seven', 'input mutation isolated');
    changedNumber('spencer', 'range', 1, () => c.near(p.rangeMetres, 300 * 0.9144, 'catalogue mutation isolated'));
  }, broken({ make: (...args) => { const u = make(...args); return { ...u, equipment: args[0] }; } })],
  ['invalid-zero-allocation', (a, c) => {
    let assignments = 0, figures = 0, coordinates = 0;
    class Counted extends Unit { set id(v) { assignments++; } makeFigures(...args) { figures++; return super.makeFigures(...args); } }
    const invalid = [null, undefined, {}, [], ...['unknown', 'constructor', 'toString', '__proto__'].map((itemId) => ({ ...gear(), itemId })),
      ...['constructor', 'toString', '__proto__'].map((conditionId) => ({ ...gear(), conditionId })),
      { ...gear(), tier: 'legendary' }, { ...gear(), uid: '' }, { ...gear(), from: '' }, { ...gear(), source: 'invented' },
      { ...gear(), depot: true }, { ...gear(), depot: false }, { ...gear(), range: Infinity }, Object.create(gear()),
      { ...gear(), [Symbol('unsupported')]: true }, { ...gear(), get from() { return 'Accessor origin'; } }, gear('sixPdr')];
    for (const it of invalid) {
      const def = { ...baseDef, equipment: it, get x() { coordinates++; return 0; } }, before = Object.getOwnPropertyDescriptors(def);
      c.refuses(() => a.construct(def, Counted), 'invalid refusal'); c.eq(Object.getOwnPropertyDescriptors(def), before, 'input untouched');
    }
    c.eq([assignments, figures, coordinates], [0, 0, 0], 'zero assignment/figures/Vehicle coordinates');
  }, broken({ construct: (def) => new Unit({ ...def, equipment: gear() }, {}, terrain, 72) })],
  ['absent-explicit-inherited', (a, c) => {
    const u = a.construct(baseDef); c.eq([Object.hasOwn(u, 'equipment'), Object.hasOwn(u, 'equipmentProfile')], [false, false], 'generic absent branch');
    c.refuses(() => a.make(undefined), 'explicit undefined'); c.refuses(() => a.make(null), 'explicit null');
    c.refuses(() => a.construct(Object.assign(Object.create({ equipment: gear() }), baseDef)), 'inherited equipment');
  }, broken({ make: () => new Unit(baseDef, {}, terrain, 72) })],
  ['supplied-type-compatibility', (a, c) => {
    c.eq(a.make(gear('sixPdr')).type, 'artillery', 'gun field mapping');
    for (const type of [null, undefined, '', 'battery', 'cavalry', 'constructor']) c.refuses(() => a.make(gear(), { type }), 'unsupported supplied type');
    c.refuses(() => a.profile(gear('sixPdr'), 'infantry'), 'gun on infantry'); c.refuses(() => a.profile(gear(), 'artillery'), 'musket on artillery');
    const absent = { ...baseDef, equipment: gear() }; delete absent.type;
    c.eq(a.construct(absent).type, 'infantry', 'absent type default');
    c.refuses(() => a.construct(Object.assign(Object.create({ type: 'infantry' }), absent)), 'inherited type');
  }, broken({ make: (it, extra) => make(it, { ...extra, type: itemDef(it.itemId).arm }) })],
  ['nonfinite-refusal-before-allocation', (a, c) => {
    let figures = 0; class Counted extends Unit { makeFigures(...args) { figures++; return super.makeFigures(...args); } }
    for (const key of ['range', 'rate', 'power', 'accuracy']) for (const v of [NaN, Infinity, -Infinity]) {
      changedNumber('m1842', key, v, () => c.refuses(() => a.construct({ ...baseDef, equipment: gear() }, Counted), 'nonfinite catalogue refusal'));
    }
    for (const key of ['range', 'rate']) changedNumber('m1842', key, 0, () => c.refuses(() => a.make(gear()), 'zero range/rate'));
    const cond = CONDITIONS[0], mult = cond.mult;
    try { cond.mult = NaN; c.refuses(() => a.make(gear('m1842', cond.id)), 'nonfinite condition'); } finally { cond.mult = mult; }
    c.eq(figures, 0, 'no figures allocated');
  }, broken({ construct: () => new Unit(baseDef, {}, terrain, 72) })],
  ['range-ghost-actual-halt', (a, c) => {
    for (const id of ['m1842', 'henry', 'sixPdr', 'whitworth']) {
      const { u, t, combat, game } = a.fixture(gear(id)), range = itemDef(id).range.v * 0.9144, eff = range * (u.type === 'artillery' ? 0.8 : 0.75);
      c.near(combat.range(u), range, 'Combat range'); c.near(game.range(u), range, 'Game range'); c.near(game.effRange(u), eff, 'Game effective range');
      const arc = Input.prototype.arcOf.call({ game }, u); c.near(arc.range, range, 'Input arc');
      const layer = new ArrowLayer(new THREE.Scene(), terrain), g = layer.ghost(0, 0, 0, u.lineHalfFront(), 'US', arc);
      try {
        const pos = g.children.find((m) => m.material === layer.arcMats.US).geometry.attributes.position;
        let radial = 0; for (let n = 0; n < pos.count; n++) radial = Math.max(radial, Math.hypot(pos.getX(n), pos.getZ(n)));
        // Positions use Float32: one ULP at the largest radius is <=0.000245m; allow 2 ULP.
        c.near(radial, range, 'actual Float32 ghost radius', 0.0005);
      } finally { layer.dropGhost(g); }
      t.vehicle.position.z = range + 400; const h = game.attackHalt(u, t); c.near(h.z, t.z - eff, 'ghost halt');
      game.order(u, { type: 'attack', target: t }); c.near(u.order.goal[1], h.z, 'actual order goal');
      u.vehicle.position.z = h.z; game.attackStep(u); c.eq(u.follow.active, false, 'actual halt at ghost');
    }
  }, changedFixture((f) => { f.combat.range = () => 1; })],
  ['range-target-boundary', (a, c) => {
    const { u, t, combat } = a.fixture(); t.vehicle.position.z = 100 * 0.9144 + t.halfFront * 0.4 + 0.01;
    combat.pickTargets(); c.eq(u.target, null, 'beyond actual front allowance');
    t.vehicle.position.z -= 0.02; combat.pickTargets(); c.eq(u.target, t, 'inside actual range');
  }, changedFixture((f) => { f.combat.range = () => 1000; })],
  ['accuracy-only-real-fire', (a, c) => {
    const low = a.volley(gear('m1842')), high = a.volley(gear('practice-smooth'));
    c.ok(low.loss > 0, 'nonempty low accuracy volley'); c.near(high.loss / low.loss, 2, '25/50 accuracy ratio'); c.eq(low.ammo, high.ammo, 'same ammo drain');
  }, broken({ volley: (it, opts) => volley(it.itemId === 'm1842' ? gear('practice-smooth') : it, opts) })],
  ['condition-once-fire-only', (a, c) => {
    for (const id of ['springfield', 'sixPdr']) {
      const service = a.volley(gear(id)), worn = a.volley(gear(id, 'worn'));
      c.near(worn.loss / service.loss, 0.88, 'one worn factor');
      const p = a.profile(gear(id), itemDef(id).arm), q = a.profile(gear(id, 'worn'), itemDef(id).arm);
      c.eq([p.rangeMetres, p.reloadSeconds], [q.rangeMetres, q.reloadSeconds], 'unchanged range and cadence');
    }
  }, broken({ volley: (it, opts) => { const r = volley(it, opts); if (it.conditionId === 'worn') r.loss *= 0.88; return r; } })],
  ['power-real-per-round', (a, c) => {
    const first = a.volley(gear('m1842'));
    changedNumber('m1842', 'power', 56, () => c.near(a.volley(gear('m1842')).loss / first.loss, 2, 'isolated power ratio'));
  }, broken({ volley: () => volley(gear('practice-smooth')) })],
  ['cadence-not-cancelled', (a, c) => {
    const slow = a.cadence(gear('m1842'));
    changedNumber('m1842', 'rate', 12, () => {
      const fast = a.cadence(gear('m1842')); c.ok(fast.shots > slow.shots * 3, 'actual faster shots');
      c.ok(fast.loss > slow.loss * 2.5, 'actual faster casualties');
    });
    c.ok(a.cadence(gear('henry')).shots > slow.shots * 4, 'real catalogue repeater cadence');
  }, broken({ cadence: (it, opts) => cadence({ ...it, itemId: 'practice-smooth', tier: 'common' }, opts) })],
  ['direct-explicit-period-independent', (a, c) => {
    const it = gear('henry'), short = a.volley(it, { period: 0.1 }), long = a.volley(it, { period: 20 }), direct = a.volley(it);
    c.ok(short.loss > 0, 'nonempty explicit volley'); c.near(short.loss, long.loss, 'explicit period cannot cancel cadence'); c.near(direct.loss, short.loss, 'default nominal per-round');
  }, broken({ volley: (it, opts = {}) => { const r = volley(it, opts); r.loss *= opts.period ?? 1; return r; } })],
  ['fatigue-period-and-fire', (a, c) => {
    const it = gear('springfield'), rested = a.volley(it), tired = a.volley(it, { fatigue: 80 });
    c.near(tired.loss / rested.loss, 1.4 * (1 - 0.35 * 0.8), 'legacy fatigue period and accuracy');
    c.ok(a.cadence(it, { fatigue: 80 }).shots < a.cadence(it).shots, 'fatigue slows reload');
  }, broken({ volley: (it, opts) => volley(it, { ...opts, fatigue: 0 }) })],
  ['moving-direct-semantics', (a, c) => {
    const it = gear('springfield'), standing = a.volley(it), defaultMoving = a.volley(it, { moving: true }), explicitMoving = a.volley(it, { moving: true, period: 0.1 });
    c.near(defaultMoving.loss / standing.loss, 0.5, 'default direct fatigue-only period');
    c.near(explicitMoving.loss / standing.loss, 0.75, 'explicit/fireStep nominal moving period');
    c.near(a.volley(it, { moving: true, period: 20 }).loss, explicitMoving.loss, 'explicit moving periods independent');
    c.ok(a.cadence(it, { moving: true }).shots < a.cadence(it).shots, 'moving reload slower');
  }, broken({ volley: (it, opts) => volley(it, { ...opts, moving: false }) })],
  ['hold-fire-restriction', (a, c) => { c.eq(a.cadence(gear('henry'), { hold: true }).shots, 0, 'Hold Fire through fireStep');
    const { u, t, combat } = a.fixture(); u.holdFire = true; combat.volleyAt(u, t, 1); c.eq(u.shots, 1, 'direct sandbox intentionally bypasses restriction');
  }, broken({ cadence: (it, opts) => cadence(it, { ...opts, hold: false }) })],
  ['run-charge-melee-routing-restrictions', (a, c) => {
    for (const opts of [{ moving: true, run: true }, { charge: true }, { melee: true }, { routing: true }]) c.eq(a.cadence(gear('henry'), opts).shots, 0, 'normal firing restricted');
  }, broken({ cadence: (it) => cadence(it) })],
  ['limber-moving-artillery-restrictions', (a, c) => {
    const it = gear('sixPdr'); c.ok(a.cadence(it).shots > 0, 'deployed gun fires');
    c.eq(a.cadence(it, { limber: true }).shots, 0, 'limbered gun'); c.eq(a.cadence(it, { moving: true }).shots, 0, 'moving gun');
  }, broken({ cadence: (it, opts) => cadence(it, { ...opts, limber: false, moving: false }) })],
  ['cover-ammo-morale-sandbox', (a, c) => {
    for (const id of ['springfield', 'sixPdr']) {
      const it = gear(id), baseline = a.volley(it, { distance: 200 });
      c.near(a.volley(it, { distance: 200, cover: 2 }).loss / baseline.loss, 0.5, 'shared cover');
      c.near(a.volley(it, { distance: 200, ammo: 50 }).loss / baseline.loss, 0.75, 'shared ammo');
      c.near(a.volley(it, { distance: 200, morale: 39 }).loss / baseline.loss, 0.8, 'shared morale');
      c.near(a.volley(it, { distance: 200, effect: 2 }).loss / baseline.loss, 2, 'sandbox shared effect');
    }
  }, broken({ volley: (it, opts) => volley(it, { ...opts, cover: 1 }) })],
  ['gun-canister-shot-and-effects', (a, c) => {
    const it = gear('sixPdr'), close = a.volley(it), far = a.volley(it, { distance: 200 }), covered = a.volley(it, { cover: 2 });
    c.eq(close.effects, [['boom', 'a', true]], 'actual canister effect'); c.eq(far.effects, [['boom', 'a', false]], 'actual shot effect');
    c.ok(close.loss > far.loss, 'canister casualty multiplier'); c.near(covered.loss / close.loss, 0.18 / 2, 'canister cover term');
    c.eq([close.ammo, close.shots, close.reload, close.underFire], [99, 1, 0.075, 1.4], 'shared gun drains and draws');
  }, broken({ volley: (it, opts) => volley(it, { ...opts, distance: 200 }) })],
  ['fight-march-halt-resume', (a, c) => {
    const { u, t, combat, game } = a.fixture(gear('m1842')), previous = RULES.moveOrder;
    try {
      RULES.moveOrder = 'fight'; game.order(u, { type: 'move', points: [[0, 0], [0, 600]], endFacing: 0 }); u.vehicle.velocity.z = 2;
      combat.fireStep(u, 0.25, 0); c.eq([u.engaged, u.follow.active, u.haltCount], [true, false, 1], 'named effective-range halt');
      t.vehicle.position.z = 2000; combat.pickTargets(); for (let n = 1; n <= 6; n++) combat.fireStep(u, 0.25, n * 0.25);
      c.eq([u.engaged, u.follow.active], [false, true], 'actual resumed retained path'); c.eq(u.order.dest, [0, 600], 'original march retained');
    } finally { RULES.moveOrder = previous; }
  }, changedFixture((f) => { f.combat.effRange = () => 1; })],
  ['shared-profile-before-and-after-step', (a, c) => {
    const { u, combat } = a.fixture(gear('henry', 'worn')); const p = u.equipmentProfile, it = JSON.stringify(u.equipment);
    for (let n = 1; n <= 8; n++) combat.step(0.25, n * 0.25);
    c.eq(u.equipmentProfile, p, 'same immutable profile'); c.eq(JSON.stringify(u.equipment), it, 'identity survives actual losses/step');
    c.ok(u.shots > 0 && u.kills > 0, 'actual normal-step named fire');
  }, changedFixture((f) => { f.combat.fireStep = () => {}; })],
  ['generic-historical-detection', (a, c) => {
    c.eq(a.replay(...GENERIC_ORACLE[0].args).hash, GENERIC_ORACLE[0].hash, 'historical trace must remain exact');
  }, broken({ replay: (...args) => ({ ...genericReplay(...args), hash: 'mutant' }) })],
];
const originalGlobals = digest({ RULES, TUNING });
let passed = 0, controls = 0;
for (const [name, test, mutant] of tests) {
  test(api, assertions(name)); passed++; console.log('PASS equipment ' + name);
  if (process.argv.includes('--prove-fail')) {
    let error; try { test(mutant, assertions(name)); } catch (e) { error = e; }
    assert.ok(error instanceof assert.AssertionError && error.message.startsWith(name + ':'), name + ': intended assertion must reject control (not a harness crash)');
    controls++; console.log('CONTROL equipment ' + name + ': ' + error.message.split('\n')[0]);
  }
}
assert.equal(digest({ RULES, TUNING }), originalGlobals, 'named B restored RULES/TUNING byte-for-byte');
verifyGeneric();
assert.ok(passed > 0 && (!process.argv.includes('--prove-fail') || controls === passed), 'nonempty named cases and intended controls');
console.log(`EQUIPMENT OK (${passed}/${tests.length} named; 115 catalogue/condition; generic A126/B/A2 126${process.argv.includes('--prove-fail') ? `; ${controls}/${tests.length} intended controls` : ''})`);
