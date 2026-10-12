// tools/packs/chattanooga.mjs: the curated source of the Chattanooga battle pack (assets/packs/chattanooga.json is
// generated from this by `node tools/build-packs.mjs chattanooga`; never edit the JSON by hand).
//
// Provenance words (AGENTS.md section 3): Verified = two independent sources agree; Inferred = one source;
// Disputed = sources disagree (both given); Estimated = arithmetic or a game value, method shown.
// Research packets (2026-10-11 session): per-phase order of battle, times and events (CH1 Orchard Knob, CH2 Lookout
// Mountain, CH3 Missionary Ridge), gap-fill strengths, guns and arms (CH1..CH3 fill), and landmark coordinates
// (OSM/HMDB/NPS/Wikipedia points). Numbers are copied from the gap-fill files unless a comment or status says otherwise;
// citations are carried on each formation. The frozen old repo's data/chattanooga.json was read for reference only:
// its unsourced strengths, its "No Real Reserve" and "Missionary Ridge Supports" abstraction units, its gun pools and
// its Maney leader at Orchard Knob (no source puts Maney's brigade there) are NOT carried.
//
// Two terrains: Orchard Knob and Missionary Ridge are fought on assets/terrain/chattanooga.json (centre 35.045,
// -85.262, half 3000 m), Lookout Mountain on assets/terrain/lookout-mountain.json (centre 35.016,-85.340, half 2000 m).
// Each phase names its terrain and build-packs projects it about that terrain's centre; woods, clearings, sites and
// labels name the terrain they belong to.
//
// Positions: { lat, lon } or { near: landmark, bearing: compass degrees (0 = north, 90 = east), m: metres }.
// `bearing` on a unit is the compass direction its line faces. Every unit position is Inferred: the sources place
// units relative to Fort Wood, Orchard Knob, Bushy Knob, the ridge, the Bird's Mill Road, the Cravens house and
// Lookout Creek, never by survey. Opening positions are where each formation stood or formed at the phase's start;
// the player redeploys freely. Schematic geometry is not metres: the order of the lines and their landmarks are
// sourced, the gaps between them are drawn to fit the terrain (each phase's positionsNote says where it is compressed).
//
// Game choices (not history): clockRatio, men per figure (computed by build-packs), xp tiers, battery crews of 20 per
// gun where no crew is sourced, AI roles, reinforcement entry points, objective circles, the oval shapes of the woods
// and clearings. The player commands every Union formation; the Confederates defend (AI role 'hold'), with one sourced
// local counterattack (Moore's brigade on Lookout, an AI 'reserve').

// ---- sources --------------------------------------------------------------------------------------------------
const OR_URL = 'https://archive.org/details/warofrebellion312unit';
const OR = (what) => `Official Records Ser. I Vol. XXXI Pt. 2, ${what} (archive.org OCR text; page numbers from OCR): ${OR_URL}`;
const OR3 = (what) => `Official Records Ser. I Vol. XXXI Pt. 3 (Serial 56), ${what}`;
const NPS9 = (sec, what = '') => `Cozzens, The Battles for Chattanooga, NPS Civil War Series 9, sec${sec}${what ? ` (${what})` : ''}: https://npshistory.com/publications/civil_war_series/9/sec${sec}.htm`;
const NPS_OK_URL = 'https://www.nps.gov/chch/learn/historyculture/orchard-knob.htm';
const NPS_OK = (what = '') => `NPS Chickamauga and Chattanooga NMP, Orchard Knob${what ? ` (${what})` : ''}: ${NPS_OK_URL}`;
const NPS_MR = 'NPS Chickamauga and Chattanooga NMP, Missionary Ridge page';
const ABT_URL = 'https://www.battlefields.org/learn/civil-war/battles/chattanooga';
const ABT = (what = '') => `American Battlefield Trust, Chattanooga${what ? ` (${what})` : ''}: ${ABT_URL}`;
const ABT_LM = 'American Battlefield Trust, Lookout Mountain map page: https://www.battlefields.org/learn/maps/chattanooga-lookout-mountain-nov-24-1863';
const WIKI_CC_URL = 'https://en.wikipedia.org/wiki/Chattanooga_campaign';
const WIKI_CC = `Wikipedia, Chattanooga campaign (siege and Cracker Line; cites Cozzens, Korn, Lamers): ${WIKI_CC_URL}`;
const WIKI_MR = 'Wikipedia, Battle of Missionary Ridge (cites Cozzens, Woodworth): https://en.wikipedia.org/wiki/Battle_of_Missionary_Ridge';
const WIKI_LM = 'Wikipedia, Battle of Lookout Mountain: https://en.wikipedia.org/wiki/Battle_of_Lookout_Mountain';
const WIKI_OOB_US = 'Wikipedia, Chattanooga campaign order of battle: Union (OR-derived; not independent of the OR)';
const WIKI_OOB_CS = 'Wikipedia, Chattanooga campaign order of battle: Confederate (OR-derived; not independent of the OR)';
const IB_HAZEN = 'Hazen\'s report (OR XXXI/2) as transcribed at ironbrigader.com';
const IB_VD = 'Van Derveer\'s report (OR XXXI/2) as transcribed at ironbrigader.com (2025/11/16)';
const GAME_CREW = 'Battery crew: game value of 20 men per gun (no sourced crew strength)';
// The army commander each phase names (scenario.enemyCommander, P3t): his sourced traits (assets/traits.json) shape the
// Confederate AI's decisions and timing, never a combat number.
const ABT_BRAGG = 'American Battlefield Trust, Braxton Bragg (biography): https://www.battlefields.org/learn/biographies/braxton-bragg';
const BRAGG = (sources) => ({ side: 'CS', name: 'Braxton Bragg', rank: 'General', role: 'commanding the Confederate Army of Tennessee', sources,
  status: 'Verified: he commanded the Army of Tennessee at Chattanooga (ABT; NPS Civil War Series 9).' });

// ---- provenance phrases used in unit status lines ---------------------------------------------------------------
const XP_CH = 'xp 3 (veteran): game rule for both armies at Chattanooga, veterans of the 1863 campaigns (Chickamauga for the Army of the Cumberland and the Army of Tennessee; Hooker\'s and Sherman\'s men came from the Army of the Potomac and the Army of the Tennessee); brigade-level service history was not researched';
const WPN_US = (why = 'no ordnance return for this brigade') => `weapon rifled: Inferred, not sourced to the brigade (${why}; the Army of the Cumberland was largely rifle-armed by late 1863 and the OR ordnance lists name Enfield, Springfield and Austrian rifle-muskets, OR XXXI/2 p. 100)`;
const WPN_CS = 'weapon rifled: Inferred, not sourced to the brigade (the 6,175 small arms captured at Chattanooga were "mostly Enfield", OR XXXI/2 pp. 99-100; the arms collected in front of Sherman were about 91% rifled, p. 583)';
const POS = (why) => `position Inferred: ${why}`;
const status = (...parts) => parts.join('; ') + '.';
const FRANCHISE = (why) => `franchise lineage: ${why}`;
const FLAT_CS = (extra = '') => `strength Estimated: no sourced 25 November strength; a flat 1,260, the mean of five sourced Army of Tennessee brigade effective strengths of November 1863 (Moore 1,205 and Walthall 1,489 on the 20 November return, quoted by Jackson; Lowrey 1,330, Smith 1,266 and Liddell 1,016 taken into the fight, Cleburne), low confidence${extra}`;
const POOL_US = (regs) => `strength Estimated: no brigade or regimental strength in the reports; ${regs} regiments times 244.8, the pooled mean of 12 sourced XIV Corps regiments on 25 November (Van Derveer 1,679 for 7; Moore's demi-brigade 737 for 3; 74th Indiana 248; 14th Ohio 274) = ${Math.round(regs * 244.8).toLocaleString('en-US')}, about +/-20%`;

// ---- landmarks (WGS84; landmark research 2026-10-11 and the terrain assets) ---------------------------------------
// Most are modern reservation, monument or cemetery anchors, used to place 1863 positions relative to them. A few are
// derived from the terrain assets' own road and stream lines (TIGERweb, NHD) and USGS 3DEP heights (said in each note).
const LANDMARKS = {
  // chattanooga terrain
  orchardKnob: { lat: 35.0404, lon: -85.2737, note: 'Orchard Knob summit: the reservation monuments (HMDB MT-64/65, about 35.0404,-85.2737 via search snippets) sit on the 3DEP high point of the knob (about 30 m above the plain); the OSM "Orchard Knob" point (35.0398,-85.2780) lies about 390 m west on flat ground and is not used. Verified (HMDB and the DEM agree within about 20 m).' },
  fortWood: { lat: 35.0448, lon: -85.292, note: 'Fort Wood, the Union fort on the high ground east of the town (Wikipedia Fort Wood Historic District coordinate; footprint not located). Inferred.' },
  bushyKnob: { lat: 35.03494, lon: -85.28987, note: 'Chattanooga National Cemetery, which the research says was Bushy Knob on the Union right in 1863 (OSM way 78506668 centroid; GNIS 35.0350,-85.2894 via Wikipedia). The cemetery location is Verified; its identity with Bushy Knob is Inferred (CH1 research).' },
  birdsMillCrest: { lat: 35.03058, lon: -85.25734, note: 'Where the terrain asset\'s Bird\'s Mill Road line (modern Birds Mill Rd on the 1863 alignment, Inferred) reaches the topographic crest of Missionary Ridge (3DEP); Wikipedia\'s battle point 35.03,-85.257 is about 70 m away. Inferred.' },
  bragg: { lat: 35.0193, lon: -85.2632, note: 'Bragg Reservation, marking Bragg\'s headquarters on the ridge (OSM; HMDB MT-92 at 35.0190,-85.2630). Verified. The 3DEP crest runs about 330 m west of this centroid.' },
  // lookout-mountain terrain
  cravens: { lat: 35.0138, lon: -85.3414, note: 'Cravens House on the bench of Lookout Mountain (OSM; rebuilt in the 1950s on the 1855 site; Wikipedia\'s battle point 35.017,-85.342 is a loose cross-check). Inferred.' },
  pointPark: { lat: 35.0114, lon: -85.3441, note: 'Point Park, the north point of the summit above the palisades (OSM; NPS). Inferred.' },
  railroadBridge: { lat: 35.02602, lon: -85.34558, note: 'Where the terrain asset\'s railroad line crosses its Lookout Creek line near the mouth: the destroyed railroad bridge of the reports. Derived from the terrain lines, Inferred.' },
  poleBridge: { lat: 35.02425, lon: -85.35136, note: 'Woods\'s pole bridge, "about 800 yards above the railroad bridge" (Woods, Hooker): 730 m up the terrain asset\'s Lookout Creek line from the railroad crossing. Estimated.' },
  baldHill: { lat: 35.02862, lon: -85.35424, note: 'Bald Hill, west of Lookout Creek near its mouth (Reynolds): the nearest 3DEP knoll on the west bank (about 50 m above the creek). The hill itself is not located by any source read. Inferred.' },
};

// ---- formations (identity is stable across phases; strengths, positions and roles are per phase) ----------------
// Franchise ids (assets/campaign.json) follow the UNIT (brigade number and core regiments, or battery), not the
// commander. After Chickamauga the Army of the Cumberland was reorganised (October 1863) and many old brigades were
// merged, so each lineage below names the regiments it shares with the Shiloh or Stones River formation of that id.
const F = (id, side, type, name, short, commander, parent, regiments) => ({ id, side, type, name, short, commander, parent, regiments });
const cmd = (name, rank) => ({ name, rank });
const FORMATIONS = [
  // Army of the Cumberland (Thomas): IV Corps (Granger), 3rd Division (Wood)
  F('us-hazen-brigade', 'US', 'infantry', 'Hazen\'s Brigade', 'Hazen', cmd('William B. Hazen', 'Brigadier General'),
    '2nd Brigade, 3rd Division (Wood), IV Corps (Granger), Army of the Cumberland', ['6th Indiana', '5th Kentucky', '6th Kentucky', '23rd Kentucky', '1st Ohio', '6th Ohio', '41st Ohio', '93rd Ohio', '124th Ohio']),
  F('us-gibson-brigade', 'US', 'infantry', 'Willich\'s Brigade', 'Willich', cmd('August Willich', 'Brigadier General'),
    '1st Brigade, 3rd Division (Wood), IV Corps (Granger), Army of the Cumberland', ['25th Illinois', '35th Illinois', '89th Illinois', '32nd Indiana', '68th Indiana', '8th Kansas', '15th Ohio', '49th Ohio', '15th Wisconsin']),
  F('us-boyle-brigade', 'US', 'infantry', 'Samuel Beatty\'s Brigade', 'S. Beatty', cmd('Samuel Beatty', 'Brigadier General'),
    '3rd Brigade, 3rd Division (Wood), IV Corps (Granger), Army of the Cumberland', ['79th Indiana', '86th Indiana', '9th Kentucky', '17th Kentucky', '13th Ohio', '19th Ohio', '59th Ohio']),
  // IV Corps, 2nd Division (Sheridan)
  F('us-wagner-brigade', 'US', 'infantry', 'Wagner\'s Brigade', 'Wagner', cmd('George D. Wagner', 'Brigadier General'),
    '2nd Brigade, 2nd Division (Sheridan), IV Corps (Granger), Army of the Cumberland', ['100th Illinois', '15th Indiana', '40th Indiana', '57th Indiana', '58th Indiana', '26th Ohio', '97th Ohio']),
  F('us-roberts-brigade', 'US', 'infantry', 'Harker\'s Brigade', 'Harker', cmd('Charles G. Harker', 'Colonel'),
    '3rd Brigade, 2nd Division (Sheridan), IV Corps (Granger), Army of the Cumberland', ['22nd Illinois', '27th Illinois', '42nd Illinois', '51st Illinois', '79th Illinois', '3rd Kentucky', '64th Ohio', '65th Ohio', '125th Ohio']),
  F('us-greusel-brigade', 'US', 'infantry', 'F. T. Sherman\'s Brigade', 'F. T. Sherman', cmd('Francis T. Sherman', 'Colonel'),
    '1st Brigade, 2nd Division (Sheridan), IV Corps (Granger), Army of the Cumberland', ['36th Illinois', '44th Illinois', '73rd Illinois', '74th Illinois', '88th Illinois', '22nd Indiana', '2nd Missouri', '15th Missouri', '24th Wisconsin']),
  // Department of the Cumberland heavy artillery
  F('us-fort-wood-guns', 'US', 'artillery', 'Fort Wood heavy guns', 'Fort Wood', null,
    'Heavy artillery of the Chattanooga line under Brig. Gen. John M. Brannan, chief of artillery; the battery that served them is not identified', ['Fort Wood (crew battery not identified)']),
  // IV Corps, 1st Division (Cruft), on Lookout Mountain
  F('us-price-brigade', 'US', 'infantry', 'Whitaker\'s Brigade', 'Whitaker', cmd('Walter C. Whitaker', 'Brigadier General'),
    '2nd Brigade, 1st Division (Brig. Gen. Charles Cruft), IV Corps, attached to Geary on 24 November', ['8th Kentucky', '96th Illinois', '35th Indiana', '40th Ohio', '51st Ohio', '99th Ohio']),
  F('us-ammen-brigade', 'US', 'infantry', 'Grose\'s Brigade', 'Grose', cmd('William Grose', 'Colonel'),
    '3rd Brigade, 1st Division (Cruft), IV Corps', ['59th Illinois', '75th Illinois', '84th Illinois', '9th Indiana', '36th Indiana', '24th Ohio']),
  // XII Corps, 2nd Division (Geary), from the Army of the Potomac with Hooker
  F('us-cobham-brigade', 'US', 'infantry', 'Cobham\'s Brigade', 'Cobham', cmd('George A. Cobham Jr.', 'Colonel'),
    '2nd Brigade, 2nd Division (Geary), XII Corps, Hooker\'s command', ['29th Pennsylvania', '111th Pennsylvania']),
  F('us-ireland-brigade', 'US', 'infantry', 'Ireland\'s Brigade', 'Ireland', cmd('David Ireland', 'Colonel'),
    '3rd Brigade, 2nd Division (Geary), XII Corps, Hooker\'s command', ['60th New York', '102nd New York', '137th New York', '149th New York']),
  F('us-candy-brigade', 'US', 'infantry', 'Candy\'s Brigade', 'Candy', cmd('Charles Candy', 'Colonel'),
    '1st Brigade, 2nd Division (Geary), XII Corps, Hooker\'s command', ['5th Ohio (about 50 men)', '7th Ohio', '66th Ohio', '28th Pennsylvania', '147th Pennsylvania']),
  // XV Corps, 1st Division (Osterhaus), from the Army of the Tennessee, cut off in Lookout Valley and lent to Hooker
  F('us-woods-brigade', 'US', 'infantry', 'Woods\'s Brigade', 'Woods', cmd('Charles R. Woods', 'Brigadier General'),
    '1st Brigade, 1st Division (Osterhaus), XV Corps, attached to Hooker on the evening of 23 November', ['76th Ohio', '3rd Missouri', '12th Missouri', '17th Missouri', '27th Missouri', '29th Missouri', '31st Missouri', '32nd Missouri']),
  F('us-williamson-brigade', 'US', 'infantry', 'Williamson\'s Brigade', 'Williamson', cmd('James A. Williamson', 'Colonel'),
    '2nd Brigade, 1st Division (Osterhaus), XV Corps, attached to Hooker', ['9th Iowa', '26th Iowa', '31st Iowa']),
  // XI Corps batteries lent to Hooker
  F('us-sahm-battery', 'US', 'artillery', 'Battery K, 1st Ohio Light Artillery (Sahm)', 'Sahm', cmd('Nicholas Sahm', 'Lieutenant'),
    'XI Corps battery lent to Hooker, under Maj. John A. Reynolds (XII Corps chief of artillery)', ['Battery K, 1st Ohio Light Artillery']),
  F('us-wiedrich-battery', 'US', 'artillery', 'Battery I, 1st New York Light Artillery (Wiedrich)', 'Wiedrich', cmd('Michael Wiedrich', 'Captain'),
    'XI Corps battery lent to Hooker, under Maj. John A. Reynolds', ['Battery I, 1st New York Light Artillery (two sections)']),
  // XIV Corps (Palmer): 3rd Division (Baird) and 1st Division (R. W. Johnson)
  F('us-turchin-brigade', 'US', 'infantry', 'Turchin\'s Brigade', 'Turchin', cmd('John B. Turchin', 'Brigadier General'),
    '1st Brigade, 3rd Division (Baird), XIV Corps (Palmer), Army of the Cumberland', ['82nd Indiana', '11th Ohio', '17th Ohio', '31st Ohio', '36th Ohio', '89th Ohio', '92nd Ohio']),
  F('us-van-derveer-brigade', 'US', 'infantry', 'Van Derveer\'s Brigade', 'Van Derveer', cmd('Ferdinand Van Derveer', 'Colonel'),
    '2nd Brigade, 3rd Division (Baird), XIV Corps (Palmer), Army of the Cumberland', ['75th Indiana', '87th Indiana', '101st Indiana', '2nd Minnesota', '9th Ohio', '35th Ohio', '105th Ohio']),
  F('us-phelps-brigade', 'US', 'infantry', 'Phelps\'s Brigade', 'Phelps', cmd('Edward H. Phelps', 'Colonel'),
    '3rd Brigade, 3rd Division (Baird), XIV Corps (Palmer), Army of the Cumberland', ['10th Indiana', '74th Indiana', '4th Kentucky', '10th Kentucky', '14th Ohio', '38th Ohio']),
  // Not the Stones River us-carlin-brigade (Carlin's old 2nd Brigade of Davis's division, none of whose regiments are
  // here): a different brigade that Carlin commanded at Chattanooga, so it has its own id.
  F('us-carlin-1st-brigade', 'US', 'infantry', 'Carlin\'s Brigade', 'Carlin', cmd('William P. Carlin', 'Brigadier General'),
    '1st Brigade, 1st Division (R. W. Johnson), XIV Corps (Palmer), Army of the Cumberland', ['104th Illinois', '38th Indiana', '42nd Indiana', '88th Indiana', '2nd Ohio', '33rd Ohio', '94th Ohio', '10th Wisconsin']),
  // Army of Tennessee (Bragg)
  F('cs-28th-alabama', 'CS', 'infantry', '28th Alabama Infantry', '28th Alabama', cmd('W. L. Butler', 'Major'),
    'Manigault\'s Brigade, Hindman\'s Division (Brig. Gen. Patton Anderson commanding), Army of Tennessee', ['28th Alabama Infantry']),
  F('cs-24th-alabama', 'CS', 'infantry', '24th Alabama Infantry', '24th Alabama', cmd('N. N. Davis', 'Colonel'),
    'Manigault\'s Brigade, Hindman\'s Division (Brig. Gen. Patton Anderson commanding), Army of Tennessee', ['24th Alabama Infantry']),
  // Walthall's brigade is the Stones River cs-anderson-brigade (Walthall's brigade under Anderson there).
  F('cs-walthall-brigade', 'CS', 'infantry', 'Walthall\'s Brigade', 'Walthall', cmd('Edward C. Walthall', 'Brigadier General'),
    'Cheatham\'s Division (Brig. Gen. John K. Jackson commanding), Hardee\'s Corps', ['24th Mississippi', '27th Mississippi', '29th Mississippi', '30th Mississippi', '34th Mississippi']),
  F('cs-moore-brigade', 'CS', 'infantry', 'Moore\'s Brigade', 'Moore', cmd('John C. Moore', 'Brigadier General'),
    'Cheatham\'s Division (Brig. Gen. John K. Jackson commanding), Hardee\'s Corps', ['37th Alabama', '40th Alabama', '42nd Alabama']),
  F('cs-pettus-brigade', 'CS', 'infantry', 'Pettus\'s Brigade (three regiments)', 'Pettus', cmd('Edmund W. Pettus', 'Brigadier General'),
    'Stevenson\'s Division, Hardee\'s Corps (the 23rd and 30th Alabama stayed on the summit)', ['20th Alabama', '31st Alabama', '46th Alabama']),
  F('cs-howell-section', 'CS', 'artillery', 'Gibson\'s section, Howell\'s Georgia Battery', 'Howell (section)', cmd('R. T. Gibson', 'Second Lieutenant'),
    'Howell\'s (Georgia) Battery, Walker\'s division artillery', ['Howell\'s Georgia Battery (one section)']),
  // Missionary Ridge. Deas's brigade is the Stones River cs-coltart-brigade (Deas's brigade under Coltart), Anderson's
  // (Tucker's) is the Stones River cs-chalmers-brigade's regiments, Strahl's is the Stones River cs-stewart-brigade;
  // their Chattanooga commanders name them here. Manigault's and Vaughan's keep their Stones River ids.
  F('cs-deas-brigade', 'CS', 'infantry', 'Deas\'s Brigade', 'Deas', cmd('Zachariah C. Deas', 'Brigadier General'),
    'Anderson\'s (Hindman\'s) Division, Hardee\'s Corps; Breckinridge commanding this part of the ridge', ['19th Alabama', '22nd Alabama', '25th Alabama', '39th Alabama', '50th Alabama', '17th Alabama Battalion Sharpshooters']),
  F('cs-manigault-brigade', 'CS', 'infantry', 'Manigault\'s Brigade', 'Manigault', cmd('Arthur M. Manigault', 'Brigadier General'),
    'Anderson\'s (Hindman\'s) Division, Hardee\'s Corps; Breckinridge commanding this part of the ridge', ['24th Alabama', '28th Alabama', '34th Alabama', '10th South Carolina', '19th South Carolina']),
  F('cs-tucker-brigade', 'CS', 'infantry', 'Anderson\'s Brigade (Tucker)', 'Tucker', cmd('William F. Tucker', 'Colonel'),
    'Anderson\'s (Hindman\'s) Division, Hardee\'s Corps; Breckinridge commanding this part of the ridge', ['7th Mississippi', '9th Mississippi', '10th Mississippi', '41st Mississippi', '44th Mississippi', '9th Mississippi Battalion Sharpshooters']),
  F('cs-vaughan-brigade', 'CS', 'infantry', 'Vaughan\'s Brigade', 'Vaughan', cmd('Alfred J. Vaughan Jr.', 'Brigadier General'),
    'Anderson\'s (Hindman\'s) Division, Hardee\'s Corps; Breckinridge commanding this part of the ridge', ['11th Tennessee', '12th Tennessee (with the 47th)', '13th Tennessee (with the 154th)', '29th Tennessee']),
  F('cs-bate-brigade', 'CS', 'infantry', 'Bate\'s Brigade (Tyler)', 'Tyler', cmd('Robert C. Tyler', 'Colonel'),
    'Breckinridge\'s Division (Bate commanding), Breckinridge\'s Corps', ['37th Georgia', '4th Georgia Battalion Sharpshooters', '10th Tennessee', '15th Tennessee (with the 37th)', '20th Tennessee', '30th Tennessee', '1st Tennessee Battalion']),
  F('cs-finley-brigade', 'CS', 'infantry', 'Florida Brigade (Finley)', 'Finley', cmd('Jesse J. Finley', 'Brigadier General'),
    'Breckinridge\'s Division (Bate commanding), Breckinridge\'s Corps', ['1st Florida (with the 3rd)', '4th Florida', '6th Florida', '7th Florida', '1st Florida Cavalry (dismounted)']),
  F('cs-strahl-brigade', 'CS', 'infantry', 'Strahl\'s Brigade', 'Strahl', cmd('Otho F. Strahl', 'Brigadier General'),
    'Stewart\'s Division, Breckinridge\'s Corps', ['4th Tennessee (with the 5th)', '19th Tennessee', '24th Tennessee', '31st Tennessee', '33rd Tennessee']),
  F('cs-stovall-brigade', 'CS', 'infantry', 'Stovall\'s Brigade', 'Stovall', cmd('Marcellus A. Stovall', 'Brigadier General'),
    'Stewart\'s Division, Breckinridge\'s Corps', ['40th Georgia', '41st Georgia', '42nd Georgia', '43rd Georgia', '52nd Georgia']),
  F('cs-cobb-battery', 'CS', 'artillery', 'Cobb\'s Kentucky Battery (Gracey)', 'Cobb', cmd('Frank P. Gracey', 'Lieutenant'),
    'Slocomb\'s artillery battalion, Breckinridge\'s Division', ['Kentucky Battery (Cobb\'s)']),
  F('cs-waters-battery', 'CS', 'artillery', 'Waters\'s Alabama Battery (Hamilton)', 'Waters', cmd('William P. Hamilton', 'Lieutenant'),
    'Courtney\'s artillery battalion, Hindman\'s Division, with Deas\'s brigade', ['Alabama Battery (Waters\')']),
];

// ---- phase 1: Orchard Knob (23 November, 13:30-15:30) -------------------------------------------------------------
const P1_SRC = [OR('No. 61 (Wood), pp. 253-256'), OR('No. 10 (Granger), pp. 128-130'), NPS9(4, 'Orchard Knob'), NPS_OK()];
const PHASE1 = {
  id: 'orchard-knob', title: 'Orchard Knob', subtitle: 'Wood\'s division advances from Fort Wood, 23 November 1863',
  terrain: 'chattanooga', groundBase: 'fields',
  date: '1863-11-23', start: '13:30', end: '15:30', clockRatio: 7, attacker: 'US', seed: 18631123,
  // The knob and the rocky ridge just south of it, both carried by about 15:00 (Wood, Hazen, Willich; NPS). The
  // circle is centred between the summit and the ridge so it holds both.
  objective: { name: 'Orchard Knob (Indian Hill) and the rocky ridge south of it', at: { near: 'orchardKnob', bearing: 175, m: 130 }, r: 350 },
  // The defenders fell back to the rifle pits at the foot of Missionary Ridge; the Union line came from Fort Wood.
  retreat: { US: { near: 'fortWood', bearing: 270, m: 100 }, CS: { near: 'orchardKnob', bearing: 95, m: 1100 } },
  camera: { target: { near: 'fortWood', bearing: 110, m: 750 }, lookBearing: 110, dist: 1800 },
  enemyCommander: BRAGG([NPS9(4, 'Orchard Knob'), ABT(), ABT_BRAGG]),
  victory: {
    attackerHolds: 'Orchard Knob is in Union hands at 15:30. (In 1863 Wood\'s division took it, and the rocky ridge south of it, by about 15:00.)',
    defenderHolds: 'The Confederates still hold Orchard Knob at 15:30. (In 1863 they did not: the 24th Alabama was driven off and the 28th captured almost whole.)',
    attackerBroken: 'Wood\'s advance has broken before Orchard Knob.',
    defenderBroken: 'The Confederate screen on Orchard Knob has broken.',
    draw: 'Orchard Knob is still contested at 15:30.',
  },
  briefing: {
    text: [
      'After its defeat at Chickamauga the Army of the Cumberland was besieged in Chattanooga, its men and animals starving, until Grant\'s "Cracker Line" through Brown\'s Ferry reopened supply at the end of October.',
      'The Confederacy was fighting to preserve slavery.',
      'At about 13:30 on 23 November, ordered only to find out whether Bragg was leaving, Wood\'s division stepped off from Fort Wood in parade order with Sheridan\'s on its right, against about 634 men of the 24th and 28th Alabama holding Orchard Knob.',
      'Bragg had already weakened his own line by sending Longstreet against Knoxville, and he later called the loss of the knob a picket line driven in.',
      'Take the knob and the barricaded ridge south of it, then hold them: the half-starved army of a month before carried the position in about an hour.',
    ],
    quote: { text: 'The troops moved into line and position with such regularity and precision as to present the appearance of a formation for review or parade, and the enemy\'s pickets, but a few hundred feet off, were apparently awaiting a display or military pageant when our skirmish line advanced and opened fire.',
      who: 'Maj. Gen. Gordon Granger, commanding the Fourth Army Corps', source: 'Official Records, Ser. I, vol. 31, pt. 2, p. 129 (Granger report No. 10)' },
    sources: ['https://npshistory.com/publications/civil_war_series/9/sec4.htm', NPS_OK_URL, OR_URL, ABT_URL, WIKI_CC_URL],
  },
  positionsNote: 'Wood\'s division forms on the open slope south and east of Fort Wood (Willich left, Hazen right, Beatty in double column behind Willich\'s left) and Sheridan\'s Wagner and Harker on the north and south slopes of Bushy Knob, now the National Cemetery (Wood, Sheridan). The 28th Alabama holds log-and-stone barricades on the rocky rise just south of the knob and the 24th the knob and its rifle pits (Hazen, Wood; NPS). The knob is drawn at the HMDB monuments and the 3DEP summit, not the OSM point 390 m west. Sheridan\'s reserve brigade (not engaged) and Bridges\'s battery (placed on the knob only that night) are not fielded. All positions Inferred.',
  strengthNote: 'Hazen\'s 2,256 effective is his own report (Inferred). Willich and Beatty split Wood\'s 5,200 "effective at Mission Ridge" (a February 1864 dispatch) plus the 23 November losses, less Hazen, by regiment after fixing four sourced regiments (Estimated). Wagner\'s 1,800 is Disputed (about 2,000 in another report, both for 25 November); Harker\'s 2,100 is Sheridan\'s 6,000 less Wagner, halved (Estimated). The two Alabama regiments are NPS\'s "about 634" split by the 14 December return plus the 146 captured (Estimated). Fort Wood\'s six heavy guns rest on one OR sentence (Inferred); crews are a game value of 20 per gun.',
  historyNote: 'Wood\'s division took Orchard Knob and the rocky ridge south of it by about 15:00, capturing the 28th Alabama almost whole with its colours for about 190 killed and wounded; Grant and Thomas chose to hold and entrench the knob, a mile from Missionary Ridge, rather than recall Wood.',
  // After-action "what really happened" and "you vs history" (CH1 research: historicalOutcome, casualtiesNote, events).
  history: {
    outcome: [
      'The Union took Orchard Knob, the rocky ridge south of it and the first line of Confederate rifle pits by about 15:00, in an attack ordered as a demonstration. The 28th Alabama was captured almost whole with its colours; the XI Corps could not clear the pits left of the knob that day, and Confederate shelling from Missionary Ridge did almost no harm.',
      'Grant and Thomas chose to hold and fortify the knob rather than recall Wood. It became their forward observation post a mile from Missionary Ridge, and Bragg, who called it a driven-in picket line, pulled Cleburne and other troops back toward the ridge and began fortifying the crest: the first step toward the assault of 25 November.',
    ],
    casualties: { US: [125, 190], CS: null, provenance: 'Disputed',
      basis: 'Union, the advance of 23 November: Granger says 125 killed and wounded; Wood\'s summary of 24 November says 29 killed and 161 wounded (190); the brigade reports come to about 195. Confederate killed and wounded are unknown; prisoners were counted as 146 (Hazen), 174 including 8 officers (Wood) and "something over 200" (Thomas).' },
    closingQuote: { text: 'Intrench them and send up support', who: 'Ulysses S. Grant, deciding to keep Orchard Knob rather than recall Wood\'s division',
      source: 'as quoted in Cozzens, The Battles for Chattanooga, NPS Civil War Series 9, sec4' },
    sources: [
      { label: 'Cozzens, The Battles for Chattanooga (NPS Civil War Series 9), sec4', url: 'https://npshistory.com/publications/civil_war_series/9/sec4.htm' },
      { label: 'NPS Chickamauga and Chattanooga NMP, Orchard Knob', url: NPS_OK_URL },
      { label: 'Official Records Ser. I Vol. XXXI Pt. 2 (Granger, Wood, Hazen and Thomas reports; OCR text)', url: OR_URL },
    ],
  },
  units: [
    { id: 'us-hazen-brigade', men: 2256, weapon: 'rifled', xp: 3, at: { near: 'fortWood', bearing: 155, m: 650 }, bearing: 105,
      sources: [OR('No. 72 (Hazen), pp. 279-281: "in all 2,256 effective officers and men"'), OR('No. 61 (Wood), pp. 254-256'), OR('organization of the forces under Grant, p. 16'), NPS9(4)],
      status: status('Identity Verified', 'strength Inferred: 2,256 effective, Hazen\'s own report (the 41st and 93rd Ohio\'s 447 engaged agree)', WPN_US(),
        XP_CH, POS('the right of Wood\'s front line on the open slope south of Fort Wood; it crossed open field, the railroad and a belt of woods to the barricaded ridge south of the knob'),
        FRANCHISE('Hazen\'s 19th Brigade of Shiloh and Stones River: the 41st Ohio and 6th Kentucky, with the 6th Indiana, 5th Kentucky, 1st Ohio and 93rd Ohio of the Stones River us-rousseau-brigade (Baldwin\'s), merged into it in October 1863 (the regiment lists of the Stones River and Chattanooga orders of battle)')) },
    { id: 'us-gibson-brigade', men: 1721, weapon: 'rifled', xp: 3, at: { near: 'fortWood', bearing: 125, m: 450 }, bearing: 110,
      sources: [OR('No. 62 (Willich), pp. 263-264'), OR('No. 61 (Wood), pp. 255-256 and the 20 February 1864 dispatch, p. 263 (5,200 effective)'), OR('Nos. 63, 68, 71 (25th Illinois 260; 8th Kansas 219; 15th Wisconsin 130)'), NPS9(4)],
      status: status('Identity Verified', 'strength Estimated: Wood\'s 5,200 effective plus his 190 losses of 23 November, less Hazen\'s 2,256 = 3,134 for Willich and Beatty; four sourced regiments fixed (909) and the other twelve at 185.4 each: 130 + 219 + 260 + 6 x 185.4 = 1,721, error several hundred',
        WPN_US('a 49th Ohio company drew Enfields in 1863'), XP_CH, POS('the left of Wood\'s front line south of Fort Wood, the 8th Kansas skirmishing ahead; it went through the woods straight at the summit'),
        FRANCHISE('W. H. Gibson\'s 6th Brigade of Shiloh and Willich\'s brigade of Stones River: the 15th and 49th Ohio, 32nd Indiana and 89th Illinois (Verified)')) },
    { id: 'us-boyle-brigade', men: 1412, weapon: 'rifled', xp: 3, at: { near: 'fortWood', bearing: 95, m: 220 }, bearing: 110,
      sources: [OR('No. 82 (S. Beatty), pp. 300-301'), OR('No. 61 (Wood), pp. 254, 256'), OR('No. 88 (Manderson, 19th Ohio: 300 on 23 November)'), OR('organization, p. 17')],
      status: status('Identity Verified', 'strength Estimated: as Willich, 300 (19th Ohio) + 6 x 185.4 = 1,412', WPN_US(), XP_CH,
        POS('division reserve in double column closed en masse behind Willich\'s left; two regiments later went through the woods toward Citico Creek'),
        FRANCHISE('Boyle\'s 11th Brigade of Shiloh (the 19th and 59th Ohio and 9th Kentucky) and Grider\'s brigade of Samuel Beatty\'s division at Stones River (the 19th Ohio, 9th Kentucky and 79th Indiana); the 86th Indiana and 13th Ohio of the Stones River us-fyffe-brigade were merged into it (regiment lists of the three orders of battle)')) },
    { id: 'us-wagner-brigade', men: 1800, weapon: 'rifled', xp: 3, at: { near: 'bushyKnob', bearing: 0, m: 200 }, bearing: 100,
      sources: [OR('No. 38 (Wagner): "about 1,800" engaged'), OR('No. 39 (Lane), p. 213: "about 2,000"'), OR('No. 27 (Sheridan), pp. 188-189'), NPS9(4, 'Sheridan guards Wood\'s right')],
      status: status('Identity Verified', 'strength Disputed: about 1,800 (Wagner) against about 2,000 (Lane), both for the 25 November assault; no loss on 23 November (Sheridan)', WPN_US(), XP_CH,
        POS('the northern slope of Bushy Knob on Wood\'s right; it advanced en echelon after the knob fell and halted about 300 yards forward'),
        FRANCHISE('Wagner\'s brigade of Stones River (the 15th, 40th and 57th Indiana and 97th Ohio), with the 100th Illinois, 58th Indiana and 26th Ohio of the Stones River us-hascall-brigade merged into it (Verified)')) },
    { id: 'us-roberts-brigade', men: 2100, weapon: 'rifled', xp: 3, at: { near: 'bushyKnob', bearing: 180, m: 150 }, bearing: 100,
      sources: [OR('No. 27 (Sheridan), p. 188: about 6,000 effective in 25 regiments'), OR('No. 38 (Wagner)'), OR('No. 10 (Granger), p. 129'), OR('organization, p. 16')],
      status: status('Identity Verified', 'strength Estimated: Sheridan\'s 6,000 less Wagner\'s 1,800, split 9:9 with Sherman\'s brigade = 2,100', WPN_US(), XP_CH,
        POS('the southern slope of Bushy Knob, the extreme Union right near Moore\'s road'), 'commander: rank Inferred (Colonel in the OR-derived order of battle)',
        FRANCHISE('Roberts\'s brigade of Stones River: the 22nd, 27th, 42nd and 51st Illinois, all four (Verified)')) },
    { id: 'us-fort-wood-guns', men: 120, guns: 6, weapon: 'parrott', xp: 2, at: { near: 'fortWood' }, bearing: 110,
      sources: [OR('No. 180 (Brannan), pp. 551-553: four 4 1/2-inch Rodman guns and two 30-pounder Parrotts in Fort Wood'), OR('No. 61 (Wood), p. 254'), GAME_CREW],
      status: status('Identity Inferred (the guns; the crew battery is not identified)', 'guns Inferred: 6 from one OCR-garbled sentence of Brannan', 'weapon parrott: rifled siege pieces, the closest game type',
        'crew Estimated: game value 20 per gun', 'xp 2 (trained): crew not identified', POS('in Fort Wood; the heavy guns opened about noon and the infantry advanced "under cover of the guns"')) },
    { id: 'cs-28th-alabama', men: 377, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 175, m: 300 }, bearing: 285,
      sources: [OR('No. 72 (Hazen), pp. 280-281: 146 captured with the colours'), OR('No. 61 (Wood), pp. 253, 256'), OR('Army of Tennessee organization, 20 November 1863, p. 659'), OR3('regimental strength return, 14 December 1863 (231 effective)'), NPS_OK('about 634 for the two regiments')],
      status: status('Identity Verified', 'strength Estimated: 231 effective on 14 December plus the 146 captured = 377 (a floor)', WPN_CS, XP_CH,
        POS('behind log-and-stone barricades on the north slope of the rocky rise just south of the knob, drawn on the 3DEP rise'),
        'commander: Butler on the OR organizations and the marker; one veteran\'s account names John C. Reid (unresolved)') },
    { id: 'cs-24th-alabama', men: 257, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 60, m: 80 }, bearing: 290,
      sources: [NPS_OK('about 634 for the 24th and 28th Alabama'), OR('Army of Tennessee organization, 20 November 1863, p. 659'), OR3('regimental strength return, 14 December 1863 (231 effective)')],
      status: status('Identity Inferred (NPS pages; the OR does not name the summit\'s holders)', 'strength Estimated: NPS 634 less the 28th\'s 377 = 257', WPN_CS, XP_CH,
        POS('on the knob and the rifle pits at its base; exact ground not established')) },
  ],
};

// ---- phase 2: Lookout Mountain (24 November, 08:30-15:00) ------------------------------------------------------------
const PHASE2 = {
  id: 'lookout-mountain', title: 'Lookout Mountain', subtitle: 'Hooker clears the Cravens House bench below the palisades, 24 November 1863',
  terrain: 'lookout-mountain', groundBase: 'woods',
  date: '1863-11-24', start: '08:30', end: '15:00', clockRatio: 22, attacker: 'US', seed: 18631124,
  // Hooker's objective was the bench and the crest of the slope, NOT the summit: the circle is centred 60 m north-east
  // of the Cravens house on the bench (about 200 m, real, below the summit plateau) so that it stops at the foot of the
  // palisades instead of climbing them.
  objective: { name: 'the Cravens House bench below the palisades', at: { near: 'cravens', bearing: 45, m: 60 }, r: 250 },
  // The Confederates went south along the mountain toward the Summertown road; Hooker's line of retreat was back across
  // Lookout Creek toward Brown's Ferry and Chattanooga.
  retreat: { US: { near: 'baldHill', bearing: 0, m: 200 }, CS: { near: 'cravens', bearing: 170, m: 1450 } },
  camera: { target: { near: 'cravens', bearing: 250, m: 1150 }, lookBearing: 45, dist: 2000 },
  enemyCommander: BRAGG([ABT_LM, NPS9(4, 'Orchard Knob'), ABT(), ABT_BRAGG]),
  victory: {
    attackerHolds: 'Hooker\'s men hold the Cravens House bench at 15:00. (In 1863 they held it from about 13:00-14:00 on, in fog.)',
    defenderHolds: 'The Cravens House bench is still in Confederate hands at 15:00. (In 1863 it was not.)',
    attackerBroken: 'Hooker\'s attack has broken on the slope below the palisades.',
    defenderBroken: 'The Confederate line on the bench has broken.',
    draw: 'The Cravens House bench is still contested at 15:00.',
  },
  briefing: {
    text: [
      'On 24 November Hooker\'s three borrowed divisions, 9,681 men by his own count, crossed Lookout Creek in fog to clear the bench below the palisades of Lookout Mountain; nobody stormed the summit.',
      'Geary\'s division crossed unopposed upstream at Wauhatchie and swept along the slope while Woods and Grose crossed near the creek\'s mouth about 11:00, so Walthall\'s Mississippians, strung along more than a mile of picket line, were struck in flank and rear.',
      'The Confederate defence failed on its own commanders\' decisions: Walker\'s division had been withdrawn the night before, and the division commander, Brig. Gen. John K. Jackson, stayed a mile behind the line, so Moore and Walthall fought without orders or support.',
      'Hooker\'s men had fought off a Confederate attack on the newly opened Cracker Line at Wauhatchie, in this valley, a month before.',
      'Take the Cravens House bench, which covers the road off the mountain\'s north end, and hold it against Moore\'s brigade and Pettus\'s regiments coming down from the summit; do not climb the palisades.',
    ],
    quote: { text: 'The movements of the enemy were very rapid. An impenetrable fog hung around the mountain all day.',
      who: 'Brig. Gen. John K. Jackson, C.S.A., commanding Cheatham\'s division, closing his report on "the unfortunate disaster on Lookout Mountain"', source: 'Official Records, Ser. I, vol. 31, pt. 2, p. 691' },
    sources: ['https://npshistory.com/publications/civil_war_series/9/sec5.htm', OR_URL, 'https://www.battlefields.org/learn/maps/chattanooga-lookout-mountain-nov-24-1863', ABT_URL, WIKI_CC_URL, 'https://en.wikipedia.org/wiki/Battle_of_Lookout_Mountain'],
  },
  positionsNote: 'Geary crossed Lookout Creek at the old mill near Wauhatchie, about 2.5 miles up the creek and off the drawn map, so his three brigades open on the lower west slope at the map\'s south-west edge (about 1.5 km north-east of the crossing), Cobham on the right under the palisades, Ireland in the centre and Candy on the left toward the creek, with Whitaker\'s brigade about 300 yards behind (Geary, Cobham, Ireland). Walthall\'s main line and camp are on the plateau west of the Cravens house, Moore\'s brigade in the trenches about 400 yards south of the house and Gibson\'s two guns in its yard (Walthall, Moore, Jackson, Gibson). Woods and Grose cross at Woods\'s pole bridge at 11:00; part of Williamson\'s brigade follows; Pettus\'s three regiments come down the Summertown road at 13:15 (Disputed: 13:00 to after 14:00). Sahm\'s and Wiedrich\'s guns fire from the hills west of the creek. The peach orchard, stone wall and road junction are not located. All positions Inferred.',
  strengthNote: 'Cobham, Ireland and Candy are Geary\'s own table of the force engaged (OCR-garbled, Inferred); Whitaker\'s 1,465 is in both Cruft\'s and Geary\'s reports (Verified); Grose\'s 1,624 is Disputed against his own 1,693. Woods and Williamson are Osterhaus\'s regimental figures less the regiments he says stayed with the batteries until evening (Estimated). Walthall\'s 1,489 and Moore\'s 1,205 are 20 November effective totals quoted by Jackson (Inferred); Pettus\'s 1,158 is the 14 December return plus his losses (Estimated). Crews are a game value of 20 per gun.',
  historyNote: 'Geary\'s, Cruft\'s and Osterhaus\'s brigades took the Cravens House bench by about 13:00-14:00 and held a line 400-500 yards beyond it in the fog; Walthall\'s brigade lost 845 men captured, Moore and Pettus held a second line until Bragg ordered the mountain abandoned, and the Confederates were gone by the early hours of 25 November.',
  // After-action history (CH2 research).
  history: {
    outcome: [
      'Union victory on the bench. By about 13:00-14:00 the Cravens House and its works were in Union hands, and Hooker\'s line stood 400-500 yards beyond it, its right on the palisades and its left near the mouth of Chattanooga Creek, held through the night in fog and cold.',
      'Walthall\'s brigade lost most of its men as prisoners. Moore\'s and Pettus\'s brigades held a second line south of the house until Bragg\'s 14:30 order to withdraw, and the Confederates were off the mountain by about 02:00 on 25 November, under fog and a lunar eclipse. The 8th Kentucky planted the first flag on Lookout Point at sunrise.',
    ],
    casualties: { US: [362, 710], CS: 1251, provenance: 'Disputed',
      basis: 'Union losses are Disputed, 362 to 710 by source; Wikipedia gives 671 (89 killed, 471 wounded, 111 captured or missing, citing OR p.83). Confederate losses were mostly prisoners: 1,251, of them 1,064 captured or missing (Wikipedia); Jackson\'s own report counts 1,044 captured (845 from Walthall, 199 from Moore) of 2,694 effective men on the bench, plus Pettus\'s 56.' },
    closingQuote: { text: 'The movements of the enemy were very rapid. An impenetrable fog hung around the mountain all day.',
      who: 'Brig. Gen. John K. Jackson, C.S.A., commanding Cheatham\'s division, closing his report on "the unfortunate disaster on Lookout Mountain"', source: 'report of 21 December 1863, Official Records Ser. I Vol. XXXI Pt. 2, p. 691' },
    sources: [
      { label: 'Cozzens, The Battles for Chattanooga (NPS Civil War Series 9), sec5', url: 'https://npshistory.com/publications/civil_war_series/9/sec5.htm' },
      { label: 'Official Records Ser. I Vol. XXXI Pt. 2 (Hooker, Geary, Cruft, Walthall and Jackson reports; OCR text)', url: OR_URL },
      { label: 'American Battlefield Trust, Lookout Mountain map (24 November 1863)', url: 'https://www.battlefields.org/learn/maps/chattanooga-lookout-mountain-nov-24-1863' },
      { label: 'NPS Historical Handbook 25, Chickamauga and Chattanooga', url: 'https://www.npshistory.com/handbooks/historical/25/hh25j3.htm' },
      { label: 'Wikipedia, Battle of Lookout Mountain', url: 'https://en.wikipedia.org/wiki/Battle_of_Lookout_Mountain' },
    ],
  },
  units: [
    { id: 'us-cobham-brigade', men: 574, weapon: 'rifled', xp: 3, at: { near: 'cravens', bearing: 235, m: 1740 }, bearing: 40,
      sources: [OR('Geary report, pp. 390 and 409 (36 officers and 538 men engaged)'), OR('Cobham report, pp. 424-426'), OR('organization table, p. 17'), WIKI_OOB_US],
      status: status('Identity Verified', 'strength Inferred: 574 in Geary\'s table of the force engaged (one source; two regiments, the 109th Pennsylvania stayed in camp)',
        'weapon rifled: Inferred from corps-level evidence (most Federal infantry carried rifle-muskets by the end of 1863)', XP_CH,
        POS('the right of Geary\'s first line, hugging the foot of the palisades; drawn about 1.5 km north-east of the Wauhatchie crossing')) },
    { id: 'us-ireland-brigade', men: 775, weapon: 'rifled', xp: 3, at: { near: 'cravens', bearing: 248, m: 1640 }, bearing: 40,
      sources: [OR('Ireland report, pp. 435-437'), OR('Geary report, pp. 392-396 and table p. 409'), OR('Godard, Lane, Randall and Eldredge reports, pp. 438-446'), 'Greene on Culp\'s Hill, Gettysburg Discussion Group (gdg.org): the brigade "armed largely with Enfield rifles" in July 1863'],
      status: status('Identity Verified', 'strength Inferred: 775 in Geary\'s table (the 60th, 102nd and 149th New York\'s reported 554 leave a plausible 221 for the 137th)',
        'weapon rifled: Inferred (the former Greene\'s brigade carried mostly Enfields in July 1863, one secondary source)', XP_CH,
        POS('the centre of Geary\'s first line, the 102nd New York skirmishing with its left on Lookout Creek; it took the Cravens yard and two guns about 12:30')) },
    { id: 'us-candy-brigade', men: 1010, weapon: 'rifled', xp: 3, at: { near: 'cravens', bearing: 263, m: 1640 }, bearing: 40,
      sources: [OR('Geary report, pp. 390 and 409 (58 officers and 952 men engaged)'), OR('Candy report, pp. 411-412; Ahl report, p. 413'), WIKI_OOB_US],
      status: status('Identity Verified', 'strength Inferred: 1,010 in Geary\'s table, the engaged column only (the 29th Ohio and seven companies of the 5th Ohio held the picket line)',
        'weapon rifled: Inferred from corps-level evidence', XP_CH, POS('the left of Geary\'s line in echelon toward Lookout Creek'),
        'commander: Candy was hurt in a fall between 14:00 and 15:00 (Disputed) and Col. William R. Creighton took the brigade') },
    { id: 'us-price-brigade', men: 1465, weapon: 'rifled', xp: 3, at: { near: 'cravens', bearing: 233, m: 2040 }, bearing: 40,
      sources: [OR('Cruft report, pp. 141-146 (110 officers and 1,355 men)'), OR('Geary report, p. 390 (the same figures)'), OR('Whitaker report, pp. 154-157'), NPS9(5)],
      status: status('Identity Verified', 'strength Verified: 1,465 in both Cruft\'s and Geary\'s reports (they may share Whitaker\'s return)', WPN_US(), XP_CH,
        POS('the second line about 300 yards behind Geary\'s first, its right opposite Cobham\'s centre; by about 13:00 at the Cravens house wall (Whitaker claims the lead; Geary and Ireland put him behind, Disputed)'),
        FRANCHISE('Price\'s brigade of Stones River: the 8th Kentucky, 35th Indiana and 51st and 99th Ohio, four of its five regiments (Verified)')) },
    { id: 'us-ammen-brigade', men: 1624, weapon: 'rifled', xp: 3, at: { near: 'poleBridge', bearing: 200, m: 220 }, bearing: 150,
      arrive: '11:00', entry: 'across Lookout Creek on Woods\'s pole bridge',
      sources: [OR('Cruft report, p. 142 (113 officers and 1,511 men)'), OR('Grose report, pp. 169-171 ("effective force, officers and men, 1,693")'), OR('Hooker report, p. 316'), NPS9(5)],
      status: status('Identity Verified', 'strength Disputed: 1,624 (Cruft\'s table, itemised) against 1,693 (Grose)', WPN_US(), XP_CH,
        POS('opposite the destroyed railroad bridge until it crossed at Woods\'s pole bridge about 11:00-11:30 and climbed on Woods\'s right'),
        'arrival time Disputed: 11:00 (Hooker) or 11:30 (Cruft)',
        FRANCHISE('Ammen\'s 10th Brigade of Shiloh and Grose\'s brigade of Stones River: the 36th Indiana and 24th Ohio, with the 84th Illinois (Verified)')) },
    { id: 'us-woods-brigade', men: 1585, weapon: 'rifled', xp: 3, at: { near: 'poleBridge', bearing: 160, m: 300 }, bearing: 150,
      arrive: '11:00', entry: 'across Lookout Creek on his own pole bridge',
      sources: [OR('Osterhaus report, pp. 598-600 (regimental strengths, 1,863 for nine regiments)'), OR('Woods report, pp. 606-608'), OR('Parker ammunition statement, p. 582 (.58 and .54 elongated ball only)'), NPS9(5)],
      status: status('Identity Verified', 'strength Estimated: Osterhaus\'s 1,863 less the 13th Illinois (278), which he says stayed with the Napoleon battery until evening = 1,585 (Woods lists all nine crossing, so Disputed)',
        'weapon rifled: Inferred (the Army of the Tennessee expended only rifle-musket cartridges on 24-27 November)', XP_CH,
        POS('the east bank at the pole bridge about 800 yards above the railroad bridge; it swung east along the mountain\'s foot')) },
    { id: 'us-williamson-brigade', men: 713, weapon: 'rifled', xp: 3, at: { near: 'poleBridge', bearing: 180, m: 400 }, bearing: 150,
      arrive: '12:30', entry: 'across Lookout Creek behind Woods',
      sources: [OR('Osterhaus report, pp. 598-600 (regimental strengths)'), OR('Williamson report, p. 614'), OR('Parker ammunition statement, p. 582')],
      status: status('Identity Verified', 'strength Estimated: the 31st (215), 9th (285) and 26th Iowa (213) = 713, the regiments that reached the mountainside before 15:00; the rest guarded batteries',
        'weapon rifled: Inferred (Army of the Tennessee ammunition)', XP_CH, POS('it crossed after Woods and climbed toward the Cravens house; the 31st Iowa relieved Geary\'s men about 14:00'),
        'arrival time Estimated: Osterhaus does not state it') },
    { id: 'us-sahm-battery', men: 80, guns: 4, weapon: 'napoleon', xp: 3, at: { near: 'baldHill' }, bearing: 140,
      sources: [OR('Reynolds report, pp. 452-454 ("four light 12-pounders")'), OR('Geary report, p. 391'), OR('Osterhaus report, p. 599 (a Napoleon battery)'), GAME_CREW],
      status: status('Identity Verified', 'guns Verified: 4 light 12-pounders (Reynolds, Geary)', 'weapon napoleon', 'crew Estimated: game value 20 per gun', XP_CH,
        POS('Bald Hill west of Lookout Creek, firing across the creek from about 11:00; it cannot reach the bench')) },
    { id: 'us-wiedrich-battery', men: 80, guns: 4, weapon: 'parrott', xp: 3, at: { near: 'baldHill', bearing: 256, m: 410 }, bearing: 120,
      sources: [OR('Reynolds report, p. 452 ("six 3-inch guns ... four of which were in position")'), OR('Geary report, p. 391 (two sections)'), GAME_CREW],
      status: status('Identity Verified', 'guns Verified: 4 of the battery\'s six 3-inch rifles in position (Reynolds, Geary)', 'weapon parrott: 3-inch rifles, the game\'s rifled class', 'crew Estimated: game value 20 per gun', XP_CH,
        POS('a hill opposite Lookout Point behind Bald Hill, west of the creek')) },
    { id: 'cs-walthall-brigade', men: 1489, weapon: 'smooth', xp: 3, at: { near: 'cravens', bearing: 270, m: 720 }, bearing: 230,
      sources: [OR('Walthall report, pp. 692-696'), OR('Jackson report, pp. 684-691 (1,489 effective on the 20 November return)'), OR('Geary report, p. 392'), 'Ordnance records of Walthall\'s brigade (NARA, transcribed on the Authentic Campaigner forum; secondary)'],
      status: status('Identity Verified', 'strength Inferred: 1,489 effective on 20 November, quoted by Jackson (a December return may imply up to about 1,669)',
        'weapon smooth: Inferred (1863 ordnance records of two of five regiments show mostly .69 smoothbores)', XP_CH,
        POS('the main line of log-and-stone breastworks and camp on the plateau west of the Cravens house, about a third of the brigade out on a picket line over a mile long')) },
    { id: 'cs-moore-brigade', men: 1205, weapon: 'rifled', xp: 3, at: { near: 'cravens', bearing: 165, m: 370 }, bearing: 320,
      ai: { role: 'reserve', at: '13:00' },
      sources: [OR('Moore report, pp. 704-706'), OR('Jackson report, pp. 688-690 (1,205 effective on 20 November)'), OR('Stevenson report, p. 720'), NPS9(5, 'Moore, "roughly 1,000"'), ABT_LM],
      status: status('Identity Verified', 'strength Inferred: 1,205 (Jackson; the 14 December return plus the 24 November losses gives about 1,211, against NPS\'s "roughly 1,000")', WPN_CS, XP_CH,
        POS('the trenches about 400 yards south of the Cravens house on the right of Walthall\'s line'),
        'AI reserve at 13:00: the American Battlefield Trust calls Moore\'s action a counterattack at about 13:00, while Moore\'s own report describes moving into the trenches and holding them until between 15:00 and 16:00 (Disputed)') },
    { id: 'cs-howell-section', men: 40, guns: 2, weapon: 'smbart', xp: 3, at: { near: 'cravens', bearing: 270, m: 25 }, bearing: 280,
      sources: [OR('Gibson report, pp. 716-717 (two 6-pounders to the Cravens house)'), OR('Jackson report, p. 691'), OR('Geary report, p. 396 (two pieces captured)'), GAME_CREW],
      status: status('Identity Verified', 'guns Verified: 2 six-pounders (Gibson, Geary)', 'weapon smbart', 'crew Estimated: game value 20 per gun', XP_CH,
        POS('the Cravens house yard; without horses, the section never fired and was overrun about 12:30')) },
    { id: 'cs-pettus-brigade', men: 1158, weapon: 'rifled', xp: 3, at: { near: 'cravens', bearing: 190, m: 280 }, bearing: 330,
      arrive: '13:15', entry: 'down the Summertown road from the summit',
      sources: [OR('Pettus report, pp. 731-733 (9 killed, 38 wounded, 9 missing)'), OR('Stevenson report, p. 720'), OR('Jackson report, p. 689'), OR3('Army of Tennessee return, 14 December 1863 (20th, 31st and 46th Alabama 1,102 effective)')],
      status: status('Identity Verified', 'strength Estimated: 1,102 effective on 14 December plus 56 lost on 24 November = 1,158, about +/-10%', WPN_CS, XP_CH,
        POS('about 300 yards south of the Cravens house, left of the road with its left on the rock bluff, relieving Walthall'),
        'arrival time Disputed: a little past 13:00 (Stevenson) to after 14:00 (NPS Series); 13:15 used') },
  ],
};

// ---- phase 3: Missionary Ridge (25 November, 15:40-17:30) -----------------------------------------------------------
const PHASE3 = {
  id: 'missionary-ridge', title: 'Missionary Ridge', subtitle: 'The Army of the Cumberland takes the rifle pits, then the crest, 25 November 1863',
  terrain: 'chattanooga', groundBase: 'fields',
  date: '1863-11-25', start: '15:40', end: '17:30', clockRatio: 6, attacker: 'US', seed: 18631125,
  // The order was the rifle pits at the foot; the circle is on the crest where the line first broke (the Bird's Mill
  // Road) and reaches south along the crest toward Bragg's headquarters.
  objective: { name: 'the crest from the Bird\'s Mill Road break toward Bragg\'s headquarters', at: { near: 'birdsMillCrest', bearing: 215, m: 480 }, r: 550 },
  // The Confederates retreated east toward South Chickamauga Creek; the Union line came from Chattanooga.
  retreat: { US: { near: 'fortWood', bearing: 100, m: 200 }, CS: { near: 'birdsMillCrest', bearing: 90, m: 1300 } },
  camera: { target: { near: 'orchardKnob', bearing: 150, m: 900 }, lookBearing: 100, dist: 2600 },
  enemyCommander: BRAGG([NPS9(7, 'Bragg tried to rally Tucker, Finley and Gibson'), ABT(), ABT_BRAGG]),
  victory: {
    attackerHolds: 'The Union holds the crest at 17:30. (In 1863 the centre broke at the Bird\'s Mill Road a few minutes before 17:00 and the crest was in Union hands by about 17:30.)',
    defenderHolds: 'Bragg\'s centre still holds the crest at 17:30. (In 1863 it did not.)',
    attackerBroken: 'The Union assault has broken on the slope of Missionary Ridge.',
    defenderBroken: 'The Confederate centre on Missionary Ridge has broken.',
    draw: 'The crest of Missionary Ridge is still contested at 17:30.',
  },
  briefing: {
    text: [
      'On 25 November the Army of the Cumberland, besieged and half-starved in Chattanooga a month before, was ordered to take only the rifle pits at the foot of Missionary Ridge when six signal guns fired (about 15:30-15:40; accounts differ).',
      'The pits proved a trap under the guns on the crest, and brigade by brigade, largely without orders, the men climbed on.',
      'The Confederate defence was weaker than its ground: Anderson\'s division was split between the base and the crest, the works sat on the topographic crest above dead ground, and Breckinridge had left the centre with no reserve, a failure of command and engineering by Bragg and Breckinridge rather than of courage.',
      'Take the pits, then the crest at the Bird\'s Mill Road, where Willich\'s and Hazen\'s brigades broke Tucker\'s Mississippians a few minutes before 17:00, and turn along the crest toward Bragg\'s headquarters.',
    ],
    quote: { text: 'By whose orders are those troops going up the hill?', who: 'Ulysses S. Grant, to Thomas, as the Union lines climbed past the rifle pits',
      source: 'American Battlefield Trust, Chattanooga (the wording as quoted there; Wikipedia and the NPS Series paraphrase the same exchange)' },
    sources: ['https://npshistory.com/publications/civil_war_series/9/sec7.htm', ABT_URL, 'https://en.wikipedia.org/wiki/Battle_of_Missionary_Ridge', OR_URL, WIKI_CC_URL],
  },
  positionsNote: 'The Union line runs from Baird\'s division on the left (Phelps, Van Derveer, Turchin) through Wood\'s (Beatty, Willich, Hazen) in front of Orchard Knob and Sheridan\'s (Wagner, Harker, F. T. Sherman) to Carlin on the right, about 1,200 yards from the ridge (NPS; Van Derveer). On the ridge from north to south: Vaughan, Deas (in the base pits) with Waters\'s battery, Manigault, Tucker at the Bird\'s Mill Road, Bate\'s brigade under Tyler and the Florida brigade at the base south of the break, Cobb\'s battery beside Bragg\'s headquarters, then Strahl and Stovall (NPS; Wikipedia). The terrain ends about 150 m south of the Bragg Reservation, so Strahl and Stovall (south of headquarters) are drawn at the south edge beside it and Carlin (toward Rossville Gap) at the south-west edge, all compressed; the Bird\'s Mill Road is the terrain\'s modern alignment, about 1.2 km north of Bragg\'s headquarters. All positions Inferred.',
  strengthNote: 'Van Derveer\'s 1,679 is his table of the force engaged (Inferred); Wagner\'s about 2,000 is Disputed against about 1,800. Hazen is his 2,256 less his 23 November losses; Willich and Beatty split Wood\'s 5,200 by regiment; Harker and Sherman halve Sheridan\'s 6,000 less Wagner; Turchin, Phelps and Carlin use a pooled 244.8 men per regiment (all Estimated). No Confederate brigade strength for 25 November was found: all eight are a flat 1,260 (Estimated, likely high for the consolidated Tennessee and Florida brigades; NPS gives about 16,000 Confederates on the ridge, Wikipedia about 20,000, Disputed). Crews are a game value of 20 per gun. No Union battery is named in the sources for this sector, so none is fielded.',
  historyNote: 'The Union centre took the base rifle pits and then the crest in about an hour; the line first broke at the Bird\'s Mill Road a few minutes before 17:00, Harker\'s brigade took Cobb\'s battery beside Bragg\'s headquarters, and Bragg\'s army retreated toward Dalton, its centre broken.',
  // After-action history (CH3 research).
  history: {
    outcome: [
      'The Union centre took the rifle pits at the foot of the ridge and then the crest in about an hour. The Confederate line first broke at the Bird\'s Mill Road breastworks about 17:00 and the centre collapsed by about 17:30-18:00; Cobb\'s battery near Bragg\'s headquarters was captured.',
      'Bragg\'s army retreated toward Dalton. Cleburne\'s stands at Tunnel Hill and Ringgold Gap kept it from complete ruin but did not change the collapse of the centre. In the three days about 40 Confederate guns were lost.',
    ],
    casualties: { US: null, CS: null, provenance: 'Disputed',
      basis: 'No figure covers the assault alone. Wagner\'s brigade lost 730, the most of any brigade (NPS Series); Sheridan\'s division 1,346 (NPS Series) or 1,256 (American Battlefield Trust); Wood\'s division 1,001 (ABT). Campaign totals for 23-25 November: Union 686 killed, 4,329 wounded and 322 missing (NPS Series); Confederate 6,667, of them 4,146 missing or captured.' },
    closingQuote: { text: 'By whose orders are those troops going up the hill?', who: 'Ulysses S. Grant, to Thomas, as the Union lines climbed past the rifle pits',
      source: 'American Battlefield Trust, Chattanooga (wording as quoted there; Wikipedia and the NPS Series paraphrase the same exchange)' },
    sources: [
      { label: 'Cozzens, The Battles for Chattanooga (NPS Civil War Series 9), sec7', url: 'https://npshistory.com/publications/civil_war_series/9/sec7.htm' },
      { label: 'American Battlefield Trust, Chattanooga', url: ABT_URL },
      { label: 'Wikipedia, Battle of Missionary Ridge', url: 'https://en.wikipedia.org/wiki/Battle_of_Missionary_Ridge' },
      { label: 'War Department / NPS, The Campaign for Chattanooga', url: 'https://npshistory.com/publications/chch/wardept/cc2.htm' },
    ],
  },
  units: [
    { id: 'us-phelps-brigade', men: 1469, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 19, m: 810 }, bearing: 100,
      sources: [OR('Hays report and the 74th Indiana and 14th Ohio reports (248 and 274)'), NPS9(7, 'Phelps on the left, opposite Vaughan'), NPS_MR, WIKI_MR, WIKI_OOB_US],
      status: status('Identity Verified', POOL_US(6), WPN_US('the 74th Indiana lost 7 Austrian and 2 Springfield rifles on 25 November'), XP_CH,
        POS('the left of Baird\'s division and of the whole assault line, opposite Vaughan'), 'commander: Phelps was killed as he reached the crest; Col. William H. Hays took the brigade') },
    { id: 'us-van-derveer-brigade', men: 1679, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 33, m: 490 }, bearing: 100,
      sources: [OR('Van Derveer report, inclosure p. 529: 102 officers and 1,577 men engaged in the assault'), IB_VD, NPS9(7), WIKI_OOB_US],
      status: status('Identity Verified', 'strength Inferred: 1,679, Van Derveer\'s own table of the force engaged on 25 November', WPN_US(), XP_CH,
        POS('the centre of Baird\'s division, about 1,200 yards from the ridge; its skirmishers were in the pits five minutes after the order')) },
    { id: 'us-turchin-brigade', men: 1714, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 77, m: 270 }, bearing: 100,
      sources: [OR('Turchin report (composition)'), NPS9(7, 'Turchin started up the ridge at 16:10'), NPS_MR, ABT('Turchin the left wing of Baird\'s division'), WIKI_OOB_US],
      status: status('Identity Verified', POOL_US(7), WPN_US(), XP_CH, POS('the right of Baird\'s division beside Wood\'s, climbing opposite Manigault')) },
    { id: 'us-boyle-brigade', men: 1361, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 150, m: 330 }, bearing: 100,
      sources: [OR('p. 263 (Wood: 5,200 effective at Missionary Ridge)'), OR('pp. 279-281 (Hazen)'), OR('Beatty and Dick (86th Indiana) reports'), NPS9(7), WIKI_MR],
      status: status('Identity Verified', 'strength Estimated: Wood\'s 5,200 less Hazen\'s 2,089 = 3,111, split 9:7 with Willich = 1,361 (Willich\'s sampled regiments run above this average, so Beatty may be high)', WPN_US(), XP_CH,
        POS('the left of Wood\'s division in front of Orchard Knob (NPS; Hazen does not place it, so Disputed); it followed Willich and Hazen up the slope')) },
    { id: 'us-gibson-brigade', men: 1750, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 170, m: 650 }, bearing: 100,
      sources: [OR('p. 263 (Wood: 5,200 effective)'), OR('Willich report; Nodine and Martin reports'), NPS9(7, 'Willich reached the pits first'), IB_HAZEN, WIKI_MR],
      status: status('Identity Verified', 'strength Estimated: 3,111 (as Beatty) times 9/16 = 1,750 (perhaps low: the 25th Illinois and 8th Kansas reported 260 and 219)', WPN_US(), XP_CH,
        POS('the centre of Wood\'s division on Hazen\'s left, starting slightly ahead; it broke over the Bird\'s Mill Road works and wheeled north')) },
    { id: 'us-hazen-brigade', men: 2089, weapon: 'rifled', xp: 3, at: { near: 'orchardKnob', bearing: 179, m: 990 }, bearing: 95,
      sources: [OR('pp. 279-281 (Hazen\'s two reports: 2,256 effective; 167 lost on 23 November)'), IB_HAZEN, NPS9(7, 'Hazen overran Tucker and drove south'), WIKI_MR],
      status: status('Identity Verified', 'strength Estimated: 2,256 less the 167 lost on 23 November = 2,089 (the morning skirmish losses of 25 November not subtracted)', WPN_US(), XP_CH,
        POS('the right of Wood\'s division, Sheridan\'s on its right; it halted about five minutes at the pits, then climbed to the Bird\'s Mill Road and turned south along the crest')) },
    { id: 'us-wagner-brigade', men: 2000, weapon: 'rifled', xp: 3, at: { near: 'bushyKnob', bearing: 119, m: 1530 }, bearing: 100,
      sources: [OR('pp. 212-213 (the brigade "went into action with an aggregate of about 2,000")'), OR('Sheridan report (6,000 effective, 25 regiments)'), NPS9(7, 'Wagner reached the empty pits first; lost 730'), WIKI_MR],
      status: status('Identity Verified', 'strength Disputed: about 2,000 against about 1,800 (the two figures are attributed differently in the research: Wagner\'s and Lane\'s reports)', WPN_US(), XP_CH,
        POS('the left of Sheridan\'s division on Wood\'s right; it drove up toward Bate\'s position')) },
    { id: 'us-roberts-brigade', men: 2000, weapon: 'rifled', xp: 3, at: { near: 'bushyKnob', bearing: 135, m: 1540 }, bearing: 100,
      sources: [OR('Sheridan report (6,000 effective)'), OR('pp. 212-213 (Wagner, about 2,000)'), OR('Harker and Opdycke reports'), NPS9(7, 'Harker captured Cobb\'s battery near Bragg\'s headquarters'), WIKI_MR],
      status: status('Identity Verified', 'strength Estimated: Sheridan\'s 6,000 less Wagner\'s 2,000, split 9:9 with Sherman = 2,000', WPN_US(), XP_CH,
        POS('the centre of Sheridan\'s division, right of Wagner; it fought about 90 minutes and took Cobb\'s battery'), 'commander: rank Inferred (Colonel in the OR-derived order of battle)') },
    { id: 'us-greusel-brigade', men: 2000, weapon: 'rifled', xp: 3, at: { near: 'bushyKnob', bearing: 150, m: 1660 }, bearing: 100,
      sources: [OR('Sheridan report (6,000 effective)'), OR('pp. 212-213 (Wagner)'), OR('F. T. Sherman report'), NPS9(7, 'Sherman came up more slowly and broke Strahl\'s second line'), WIKI_MR],
      status: status('Identity Verified', 'strength Estimated: as Harker, 2,000', WPN_US(), XP_CH, POS('the right of Sheridan\'s division, between Harker and Johnson\'s division'),
        FRANCHISE('Sill\'s (Greusel\'s) 1st Brigade of Sheridan\'s division at Stones River: the 36th and 88th Illinois and 24th Wisconsin (Sherman commanded the 88th), with the 44th and 73rd Illinois and 2nd and 15th Missouri of the Stones River us-schaefer-brigade merged into it (Verified)')) },
    { id: 'us-carlin-1st-brigade', men: 1958, weapon: 'rifled', xp: 3, at: { near: 'bushyKnob', bearing: 161, m: 1830 }, bearing: 95,
      sources: [OR('Carlin report and seven regimental reports (no strength)'), NPS9(7, 'Carlin took his part of the crest at 17:30'), WIKI_MR, ABT('Johnson on the extreme right'), WIKI_OOB_US],
      status: status('Identity Verified', POOL_US(8), WPN_US(), XP_CH,
        POS('the extreme right of the assault line toward Rossville Gap, which is off the drawn map: drawn at its south-west edge; it climbed hesitantly on steep ground and reached the crest last')) },
    { id: 'cs-vaughan-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'birdsMillCrest', bearing: 13, m: 1640 }, bearing: 280,
      sources: [NPS9(7, 'Phelps opposite Vaughan; Vaughan\'s retreat ended the fighting on the centre and right'), WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Inferred (NPS Series and the OOB)', FLAT_CS(' (four consolidated Tennessee units: probably high)'), WPN_CS, XP_CH, POS('the north end of Anderson\'s line on the crest, opposite Phelps')) },
    { id: 'cs-deas-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'birdsMillCrest', bearing: 345, m: 1240 }, bearing: 285,
      sources: [NPS9(7, 'Deas commands the base pits; one volley at 200 yards, then up the slope'), WIKI_MR, WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Verified', FLAT_CS(), WPN_CS, XP_CH,
        POS('the base rifle pits north of Manigault, opposite Turchin and Van Derveer (the rest of his brigade was on the ridge)')) },
    { id: 'cs-waters-battery', men: 80, guns: 4, weapon: 'napoleon', xp: 3, at: { near: 'birdsMillCrest', bearing: 16, m: 1200 }, bearing: 280,
      sources: [NPS9(7, 'Waters\'s battery\'s four guns, three lost'), OR('Army of Tennessee organization, 20 November 1863 (Lt. William P. Hamilton)'), WIKI_OOB_CS, GAME_CREW],
      status: status('Identity Inferred', 'guns Inferred: 4 (NPS Series, one source)', 'weapon napoleon: an unsourced guess (most of the 40 guns captured at Chattanooga were smoothbores, OR p. 99)', 'crew Estimated: game value 20 per gun', XP_CH,
        POS('on the ridge with Deas\'s brigade north of the Bird\'s Mill Road')) },
    { id: 'cs-manigault-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'birdsMillCrest', bearing: 17, m: 730 }, bearing: 285,
      sources: [NPS9(7), NPS_MR, WIKI_MR, WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Verified', FLAT_CS(' (the 2,315 on a park tablet is Chickamauga\'s, not used)'), WPN_CS, XP_CH,
        POS('front rank in the base works and rear rank on the crest, between Deas and Tucker; drawn on the crest')) },
    { id: 'cs-tucker-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'birdsMillCrest', bearing: 339, m: 40 }, bearing: 280,
      sources: [NPS9(7, 'Tucker\'s Mississippians collapsed at the Bird\'s Mill road a few minutes before 17:00'), WIKI_MR, WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Verified', FLAT_CS(), WPN_CS, XP_CH, POS('the crest breastworks along the Bird\'s Mill Road, where the line first broke')) },
    { id: 'cs-bate-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'birdsMillCrest', bearing: 248, m: 940 }, bearing: 290,
      sources: [NPS9(7, 'Bate\'s brigades left at the base; Tyler\'s routed'), WIKI_MR, WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Inferred', FLAT_CS(' (seven small units)'), WPN_CS, XP_CH, POS('the lower works at the base of the ridge south of the break'),
        'commander: Tyler was wounded (Wikipedia\'s OOB) or killed (the NPS Series as relayed); Disputed') },
    { id: 'cs-finley-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'bragg', bearing: 307, m: 920 }, bearing: 290,
      sources: [NPS9(7, 'Bragg tried to rally Tucker, Finley and Gibson'), WIKI_MR, WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Inferred', FLAT_CS(' (the Florida regiments were small, so probably high)'), WPN_CS, XP_CH, POS('the base of the ridge south of Tyler, toward Bragg\'s headquarters'),
        'commander: rank Disputed (Brigadier General in Wikipedia\'s OOB; an OR-derived table lists him as the colonel of the 6th Florida)') },
    { id: 'cs-cobb-battery', men: 80, guns: 4, weapon: 'napoleon', xp: 3, at: { near: 'bragg', bearing: 300, m: 330 }, bearing: 290,
      sources: [NPS9(7, 'four Napoleon twelve-pounders beside Bragg\'s headquarters, taken by Harker'), 'NPS Chickamauga and Chattanooga NMP, Bragg Reservation (Cobb\'s guns mark the position)', OR('Army of Tennessee organization, 20 November 1863 (Lt. Frank P. Gracey)'), GAME_CREW],
      status: status('Identity Verified', 'guns Verified: 4 Napoleons (NPS Series; the battery\'s history)', 'weapon napoleon', 'crew Estimated: game value 20 per gun', XP_CH,
        POS('on the narrow crest beside Bragg\'s headquarters, drawn on the 3DEP crest west of the reservation centroid'), 'commander: Gracey on the 20 November organization (Inferred)') },
    { id: 'cs-strahl-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'bragg', bearing: 266, m: 370 }, bearing: 290,
      sources: [NPS9(7, 'Strahl and Stovall defended the crest; Stewart pulled them out about 17:15'), WIKI_MR, WIKI_OOB_CS, OR('Cheatham and Cleburne reports (the five brigade strengths)')],
      status: status('Identity Verified', FLAT_CS(' (December returns of two of its regiments suggest only 800 to 1,000)'), WPN_CS, XP_CH,
        POS('on the ridge south of Bragg\'s headquarters, off the drawn map: drawn at the south edge beside it')) },
    { id: 'cs-stovall-brigade', men: 1260, weapon: 'rifled', xp: 3, at: { near: 'bragg', bearing: 252, m: 180 }, bearing: 290,
      sources: [NPS9(7), WIKI_MR, WIKI_OOB_CS, OR('Stewart\'s division casualty table (Stovall lost 84)')],
      status: status('Identity Inferred', FLAT_CS(), WPN_CS, XP_CH, POS('on the crest south of Bragg\'s headquarters beside Strahl, off the drawn map: drawn at the south edge')) },
  ],
};

// ---- the ground ----------------------------------------------------------------------------------------------------
// Chattanooga terrain (fields base): the valley between Fort Wood and Missionary Ridge was largely open ("nearly a mile
// of mostly open ground", NPS; "several hundred yards of open field", Hazen), with the woods the reports name drawn as
// ovals. Lookout terrain (woods base): a wooded mountainside with the Cravens farm and the fields at the mountain's
// foot cleared. Sizes and shapes are not sourced (Inferred); each is drawn around the place the reports put it.
const WOODS = [
  { terrain: 'chattanooga', name: 'The belt of woods west of Orchard Knob (Willich went through it; Hazen crossed it)', at: { near: 'orchardKnob', bearing: 280, m: 550 }, shape: { rx: 420, rz: 150, axis: 20 } },
  { terrain: 'chattanooga', name: 'The rocky wooded rise just south of Orchard Knob (the 28th Alabama\'s barricades)', at: { near: 'orchardKnob', bearing: 180, m: 330 }, shape: { rx: 230, rz: 100, axis: 30, points: 10 } },
  { terrain: 'chattanooga', name: 'Woods toward Citico Creek (where Beatty\'s regiments took the rifle pits in flank)', at: { near: 'orchardKnob', bearing: 25, m: 750 }, shape: { rx: 300, rz: 200, axis: 40 } },
];
const CLEARINGS = [
  { terrain: 'lookout-mountain', name: 'The Cravens farm on the bench: house yard, peach orchard and fields', at: { near: 'cravens', bearing: 300, m: 80 }, shape: { rx: 260, rz: 160, axis: 120 } },
  { terrain: 'lookout-mountain', name: 'The fields at the mountain\'s foot along Lookout Creek (Candy\'s regiments scoured them)', at: { near: 'railroadBridge', bearing: 185, m: 520 }, shape: { rx: 480, rz: 240, axis: 60 } },
  { terrain: 'lookout-mountain', name: 'Bald Hill and the batteries\' ground west of the creek', at: { near: 'baldHill', bearing: 250, m: 180 }, shape: { rx: 360, rz: 200, axis: 80, points: 10 } },
];
const SITES = [
  { terrain: 'lookout-mountain', id: 'cravens-house', name: 'Cravens House (the "white house")', at: { near: 'cravens' }, rot: 0.4, yard: 22, fenceRadius: 140,
    source: '35.0138,-85.3414 Inferred (OSM; the house was rebuilt in the 1950s on the 1855 site); the peach orchard is in Geary\'s and Ireland\'s reports; footprint and orchard placement are game stand-ins',
    buildings: [[0, 0, 12, 8, 6.5, 0, 'frame-house'], [18, 10, 7, 5, 3.6, 0, 'shed']], orchard: [-70, 45, 7, 5, 0.4] },
];

// Labels: places at their landmark points; streams and roads on their terrain lines (approximately).
const LABELS = [
  { terrain: 'chattanooga', text: 'Orchard Knob', at: { near: 'orchardKnob', bearing: 0, m: 70 }, height: 34 },
  { terrain: 'chattanooga', text: 'Missionary Ridge', at: { near: 'birdsMillCrest', bearing: 20, m: 950 }, height: 50 },
  { terrain: 'chattanooga', text: 'Fort Wood', at: { near: 'fortWood', bearing: 0, m: 60 }, height: 28 },
  { terrain: 'chattanooga', text: 'Bushy Knob (now the National Cemetery)', at: { near: 'bushyKnob' }, height: 22 },
  { terrain: 'chattanooga', text: 'Bird\'s Mill Road', at: { near: 'birdsMillCrest', bearing: 250, m: 140 }, height: 24 },
  { terrain: 'chattanooga', text: 'Bragg\'s headquarters', at: { near: 'bragg', bearing: 300, m: 200 }, height: 26 },
  { terrain: 'chattanooga', text: 'Citico Creek', at: { onStream: 'Citico Creek', frac: 0.55 }, height: 26, italic: true },
  { terrain: 'chattanooga', text: 'Tennessee River', at: { onStream: 'Tennessee River', frac: 0.5 }, height: 44, italic: true },
  { terrain: 'lookout-mountain', text: 'Lookout Mountain', at: { near: 'pointPark', bearing: 215, m: 800 }, height: 52 },
  { terrain: 'lookout-mountain', text: 'Cravens House', at: { near: 'cravens', bearing: 0, m: 50 }, height: 28 },
  { terrain: 'lookout-mountain', text: 'Lookout Point (the palisades)', at: { near: 'pointPark', bearing: 0, m: 40 }, height: 26 },
  { terrain: 'lookout-mountain', text: 'Lookout Creek', at: { onStream: 'Lookout Creek', frac: 0.55 }, height: 32, italic: true },
  { terrain: 'lookout-mountain', text: 'Chattanooga Creek', at: { onStream: 'Chattanooga Creek', frac: 0.6 }, height: 28, italic: true },
  { terrain: 'lookout-mountain', text: 'Tennessee River', at: { onStream: 'Tennessee River', frac: 0.5 }, height: 44, italic: true },
  { terrain: 'lookout-mountain', text: 'Lookout Valley', at: { near: 'poleBridge', bearing: 250, m: 700 }, height: 34 },
];

export const PACK = {
  id: 'chattanooga',
  title: 'Chattanooga',
  battle: 'Chattanooga (Orchard Knob, Lookout Mountain, Missionary Ridge)',
  terrain: 'chattanooga',
  season: 'autumn',
  groundBase: 'fields',
  treeSpacing: 18,
  woodsNote: 'Orchard Knob and Missionary Ridge: open valley ground ("nearly a mile of mostly open ground", NPS) with the woods the reports name drawn as ovals. Lookout Mountain: a wooded mountainside with the Cravens farm, the fields at the mountain\'s foot and Bald Hill cleared. Sizes and shapes are not sourced (Inferred). Fought in late November fog and cold (Jackson; Hooker).',
  labelsNote: 'Place labels sit at HMDB, OSM, NPS and cemetery points, or on the terrain assets\' own lines for the Bird\'s Mill Road and the streams (Inferred).',
  landmarks: LANDMARKS,
  formations: FORMATIONS,
  clearings: CLEARINGS,
  woods: WOODS,
  sites: SITES,
  labels: LABELS,
  phases: [PHASE1, PHASE2, PHASE3],
};
