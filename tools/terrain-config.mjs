// tools/terrain-config.mjs: one entry per battlefield for tools/fetch-terrain.mjs.
// center: WGS84 lat/lon of the local origin; halfSize: metres from the centre to each edge; grid: 2^n + 1.
// roads: modern USGS road-name fragment -> period name (kind 'pike' draws wider). streams: NHD gnis_name fragment
// (kind 'river' draws wider). Modern alignments only stand in for period roads where noted as following them.
export const TERRAIN = {
  'henry-hill': {
    name: 'Henry House Hill to Matthews Hill (First Bull Run, 21 July 1861)',
    center: { lat: 38.81825, lon: -77.5225 }, halfSize: 1300, grid: 513,
    roadsNote: 'Lee Hwy, Sudley Rd: modern alignments of the 1861 roads',
    roads: [{ match: 'Lee Hwy', name: 'Warrenton Turnpike', kind: 'pike' }, { match: 'Sudley Rd', name: 'Sudley Road' }],
    streams: [{ match: 'Youngs Branch' }, { match: 'Chinn Branch' }, { match: 'Holkums Branch' }, { match: 'Dogans Branch' },
      { match: 'Bull Run', kind: 'river' }],
  },
  shiloh: {
    name: 'Shiloh: Pittsburg Landing to Fraley Field (6-7 April 1862)',
    center: { lat: 35.135, lon: -88.340 }, halfSize: 2600, grid: 1025,
    roadSource: 'tiger',
    roadsNote: 'park roads on the 1862 Corinth, Hamburg-Purdy, Hamburg-Savannah, Bark and Sunken Road traces; Inferred, and the Eastern Corinth Road was relocated after the war (Bearss 1973)',
    roads: [{ match: 'Eastern Corinth Rd', name: 'Eastern Corinth Road' }, { match: 'Hamburg Purdy Rd', name: 'Hamburg-Purdy Road' },
      { match: 'Hamburg Savannah Rd', name: 'Hamburg-Savannah Road', kind: 'pike' }, { match: 'Sunken Rd', name: 'Sunken Road' },
      { match: 'Pittsburg Landing Rd', name: 'Pittsburg Landing Road' }, { match: 'Fraley Dr', name: 'Bark Road' }],
    streams: [{ match: 'Tennessee River', kind: 'river' }, { match: 'Owl Creek' }, { match: 'Lick Creek', name: 'Lick Creek' },
      { match: 'Shiloh Branch' }, { match: 'Dill Branch' }, { match: 'Spain Branch' }, { match: 'Tilghman Branch' }],
  },
  'stones-river': {
    name: 'Stones River: the Nashville Pike to McFadden Ford (31 December 1862 - 2 January 1863)',
    center: { lat: 35.873, lon: -86.437 }, halfSize: 2600, grid: 1025,
    roadSource: 'tiger',
    roadsNote: 'modern roads on the 1862 Nashville Pike, Wilkinson Pike, Manson Pike, McFadden Lane and Gresham Lane alignments, and the railroad (Inferred)',
    roads: [{ match: 'Old Nashville Hwy', name: 'Nashville Pike', kind: 'pike' }, { match: 'Wilkinson Pike', name: 'Wilkinson Pike', kind: 'pike' },
      { match: 'Manson Pike', name: 'Manson Pike' }, { match: 'Van Cleve Ln', name: "McFadden's Lane" }, { match: 'Gresham Ln', name: 'Gresham Lane' },
      { match: 'Csx Transportation', name: 'Nashville and Chattanooga Railroad', kind: 'rail' }],
    streams: [{ match: 'West Fork Stones River', name: 'Stones River', kind: 'river' }, { match: 'Overall Creek' }, { match: 'Lytle Creek' },
      { match: 'Sinking Creek' }],
  },
  chattanooga: {
    name: 'Chattanooga: Orchard Knob to Missionary Ridge and Tunnel Hill (23-25 November 1863)',
    center: { lat: 35.045, lon: -85.262 }, halfSize: 3000, grid: 1025,
    roadSource: 'tiger',
    roadsNote: "modern roads on the 1863 Bird's Mill, Rossville and Shallow Ford alignments, and the railroad (Inferred)",
    roads: [{ match: 'Birds Mill Rd', name: "Bird's Mill Road" }, { match: 'Rossville Blvd', name: 'Rossville Road', kind: 'pike' },
      { match: 'Shallowford Rd', name: 'Shallow Ford Road' }, { match: 'Csx Transportation', name: 'Railroad', kind: 'rail' },
      { match: 'Norfolk Southern Rlwy', name: 'Railroad', kind: 'rail' }],
    streams: [{ match: 'Tennessee River', kind: 'river' }, { match: 'Citico Creek' }, { match: 'Dobbs Branch' }],
  },
  'lookout-mountain': {
    name: 'Lookout Mountain: the Cravens House bench and Lookout Creek (24 November 1863)',
    center: { lat: 35.016, lon: -85.340 }, halfSize: 2000, grid: 1025, roadSource: 'tiger',
    roadsNote: "modern roads on the 1863 Wauhatchie Pike, Brown's Ferry road and Cravens bench alignments, and the railroad (Inferred)",
    roads: [{ match: 'Old Wauhatchie Pike', name: 'Wauhatchie Pike', kind: 'pike' }, { match: 'Browns Ferry Rd', name: "Brown's Ferry Road" },
      { match: 'Cravens Ter', name: 'Cravens House road' }, { match: 'Csx Transportation', name: 'Railroad', kind: 'rail' },
      { match: 'Norfolk Southern Rlwy', name: 'Railroad', kind: 'rail' }],
    streams: [{ match: 'Tennessee River', kind: 'river' }, { match: 'Lookout Creek' }, { match: 'Chattanooga Creek' }],
  },
};
