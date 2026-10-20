/* DayZ Studio - static data: worlds, towns, asset catalog, prefabs, quest node schema */
(function () {
  const DS = (window.DS = window.DS || {});

  DS.WORLDS = [
    { id: 'chernarusplus', name: 'Chernarus+', size: 15360, mission: 'dayzOffline.chernarusplus' },
    { id: 'enoch', name: 'Livonia', size: 12800, mission: 'dayzOffline.enoch' },
    { id: 'sakhal', name: 'Sakhal', size: 15360, mission: 'dayzOffline.sakhal' },
    { id: 'namalsk', name: 'Namalsk (mod map)', size: 20480, mission: 'dayzOffline.namalsk' },
    { id: 'deerisle', name: 'Deer Isle (mod map)', size: 16384, mission: 'dayzOffline.deerisle' },
    { id: 'custom', name: 'Custom map', size: 10240, mission: 'dayzOffline.custom' },
  ];

  /* Approximate town centres (metres, x east / z north) used only as visual landmarks. */
  DS.TOWNS = {
    chernarusplus: [
      ['Chernogorsk', 6600, 2400], ['Elektrozavodsk', 10400, 2300], ['Balota', 4400, 2400],
      ['Kamenka', 1950, 2200], ['Zelenogorsk', 2700, 5300], ['Pavlovo', 1700, 3900],
      ['Prigorodki', 7900, 3300], ['Mogilevka', 7500, 5200], ['Msta', 11200, 5400],
      ['Solnichniy', 13400, 6200], ['Kamyshovo', 12000, 3500], ['Stary Sobor', 6100, 7700],
      ['Novy Sobor', 7100, 7700], ['Vybor', 3800, 8900], ['Gorka', 9500, 8800],
      ['Polana', 10800, 8200], ['Berezino', 12900, 9500], ['NWAF', 4500, 10300],
      ['Krasnostav', 11200, 12200], ['Severograd', 8300, 12700], ['Svetlojarsk', 13900, 13250],
      ['Novodmitrovsk', 11400, 14300], ['Tisy', 1600, 14000],
    ],
  };

  /* ---- entity kinds (drives colour, shape, export behaviour) ---- */
  DS.KINDS = {
    building: { name: 'Building / Structure', color: '#60a5fa', shape: 'rect', isStatic: true },
    prop: { name: 'Prop / Container', color: '#fbbf24', shape: 'square', isStatic: true },
    loot: { name: 'Loot Spawn', color: '#a3e635', shape: 'diamond' },
    item: { name: 'Item', color: '#34d399', shape: 'circle' },
    vehicle: { name: 'Vehicle', color: '#22d3ee', shape: 'tri' },
    infected: { name: 'Infected', color: '#f87171', shape: 'cross' },
    animal: { name: 'Animal', color: '#fb923c', shape: 'cross' },
    npc: { name: 'NPC / Survivor', color: '#c084fc', shape: 'star' },
    event: { name: 'Event Spawn Point', color: '#f472b6', shape: 'diamond' },
    fx: { name: 'Effect / Sound', color: '#e879f9', shape: 'circle' },
  };

  /* ---- placed effects: vanilla particles (ParticleList) and sound sets, all checked against DayZ 1.30 scripts ---- */
  DS.FX_PARTICLES = [
    ['', 'None'],
    ['CAMP_SMALL_FIRE', 'Small fire'], ['CAMP_NORMAL_FIRE', 'Campfire'], ['BONFIRE_FIRE', 'Bonfire'], ['HOUSE_NORMAL_FIRE', 'House fire'],
    ['BARREL_NORMAL_FIRE', 'Barrel fire'], ['CAMP_NORMAL_SMOKE', 'Campfire smoke'], ['BONFIRE_SMOKE', 'Bonfire smoke'],
    ['SMOKE_GENERIC_WRECK', 'Burning wreck smoke (big)'], ['POWER_GENERATOR_SMOKE', 'Generator exhaust'], ['SMOKING_BARREL_STEAM', 'Steam'],
    ['GRENADE_RDG2_WHITE_LOOP', 'White smoke'], ['GRENADE_RDG2_BLACK_LOOP', 'Black smoke'], ['GRENADE_M18_GREEN_LOOP', 'Green signal smoke'],
    ['CONTAMINATED_AREA_GAS_AROUND', 'Toxic gas cloud'], ['CONTAMINATED_AREA_GAS_GROUND', 'Toxic gas on the ground'], ['CONTAMINATED_AREA_GAS_TINY', 'Small toxic gas'],
    ['LEVER_SPARKS', 'Electric sparks (one-shot)'], ['BARBED_WIRE_SPARKS', 'Short-circuit sparks (one-shot)'],
    ['FLAREPROJ_ACTIVATE_RED', 'Red flare'], ['FLAREPROJ_ACTIVATE_GREEN', 'Green flare'], ['RGD5', 'Explosion (one-shot)'],
  ];
  DS.FX_SOUNDS = [
    ['', 'None'], ['@file', 'My own sound file (.ogg / .wav)…'],
    ['AlarmClock_Ring_Loop_SoundSet', 'Alarm bell'], ['KitchenTimer_Ticking_Loop_SoundSet', 'Ticking'],
    ['Bunker_Lamp_Hum_SoundSet', 'Electric hum'], ['Power_Station_generator_overpowered_SoundSet', 'Overloaded generator'],
    ['ContaminatedArea_SoundSet', 'Toxic zone'], ['Geyser_bubbling_loop_SoundSet', 'Bubbling'], ['HeavyFire_SoundSet', 'Big fire'],
    ['LightFire_SoundSet', 'Small fire'], ['Blowtorch_Loop_SoundSet', 'Blowtorch'], ['DustWindGust_SoundSet', 'Wind gust'],
  ];
  const FX = (o) => Object.assign({ particle: '', repeat: 0, light: false, color: '#ffaa55', radius: 10, brightness: 5, soundset: '', sound: null, range: 300, startOff: false, when: { kind: '' } }, o);
  DS.FX_PRESETS = [
    { name: 'Campfire', fx: FX({ particle: 'CAMP_NORMAL_FIRE', light: true, color: '#ff8c3a', radius: 12, brightness: 4, soundset: 'LightFire_SoundSet' }) },
    { name: 'Burning wreck', fx: FX({ particle: 'SMOKE_GENERIC_WRECK', light: true, color: '#ff7a2a', radius: 15, brightness: 3, soundset: 'HeavyFire_SoundSet', range: 800 }) },
    { name: 'Toxic anomaly', fx: FX({ particle: 'CONTAMINATED_AREA_GAS_AROUND', light: true, color: '#7dff5a', radius: 18, brightness: 6, soundset: 'ContaminatedArea_SoundSet', range: 500 }) },
    { name: 'Electric anomaly', fx: FX({ particle: 'LEVER_SPARKS', repeat: 1.5, light: true, color: '#7fb2ff', radius: 10, brightness: 8, soundset: 'Bunker_Lamp_Hum_SoundSet' }) },
    { name: 'Alarm', fx: FX({ light: true, color: '#ff3030', radius: 8, brightness: 6, soundset: 'AlarmClock_Ring_Loop_SoundSet', range: 200 }) },
    { name: 'Generator hum', fx: FX({ particle: 'POWER_GENERATOR_SMOKE', soundset: 'Power_Station_generator_overpowered_SoundSet', range: 150 }) },
    { name: 'Signal smoke (green)', fx: FX({ particle: 'GRENADE_M18_GREEN_LOOP', repeat: 20, range: 1500 }) },
    { name: 'Glow light', fx: FX({ light: true, color: '#ffe8a0', radius: 10, brightness: 5 }) },
    { name: 'Ambient sound (my file)', fx: FX({ soundset: '@file', range: 120 }) },
  ];

  /* ---- asset catalog.  entry: [className, label]  ---- */
  DS.CATALOG = [
    { id: 'buildings', name: 'Buildings & Structures', kind: 'building', items: [
      ['Land_House_1W01', 'House 1W01'], ['Land_House_1W02', 'House 1W02'], ['Land_House_1W03', 'House 1W03'],
      ['Land_House_1W04', 'House 1W04'], ['Land_House_1W05', 'House 1W05'], ['Land_House_1W06', 'House 1W06'],
      ['Land_House_2W01', 'House 2W01'], ['Land_House_2W02', 'House 2W02'], ['Land_House_2B01', 'Brick house 2B01'],
      ['Land_House_1B01_Pub', 'Pub'], ['Land_Barn_Brick1', 'Brick barn 1'], ['Land_Barn_Brick2', 'Brick barn 2'],
      ['Land_Barn_Wood1', 'Wood barn 1'], ['Land_Barn_Wood2', 'Wood barn 2'], ['Land_Shed_Closed', 'Closed shed'],
      ['Land_Shed_M1', 'Shed M1'], ['Land_Shed_W1', 'Shed W1'],
      ['Land_Mil_Barracks1', 'Barracks 1'], ['Land_Mil_Barracks2', 'Barracks 2'], ['Land_Mil_Barracks3', 'Barracks 3'],
      ['Land_Mil_Barracks4', 'Barracks 4'], ['Land_Mil_Barracks5', 'Barracks 5'], ['Land_Mil_Barracks6', 'Barracks 6'],
      ['Land_Mil_GuardBox_Green', 'Guard box (green)'], ['Land_Mil_GuardBox_Brown', 'Guard box (brown)'],
      ['Land_Mil_GuardBox_Smalltown', 'Guard box (small town)'], ['Land_Mil_Tower_Small', 'Mil tower (small)'],
      ['Land_Mil_ATC_Small', 'Small ATC'], ['Land_Container_1Bo', 'Shipping container (blue)'],
      ['Land_Container_1Mo', 'Shipping container (red)'],
    ] },
    { id: 'props', name: 'Props, Crates & Camps', kind: 'prop', items: [
      ['SeaChest', 'Sea chest'], ['WoodenCrate', 'Wooden crate'], ['Barrel_Blue', 'Barrel (blue)'],
      ['Barrel_Green', 'Barrel (green)'], ['Barrel_Red', 'Barrel (red)'], ['Barrel_Yellow', 'Barrel (yellow)'],
      ['LargeTent', 'Large tent'], ['MediumTent', 'Medium tent'], ['CarTent', 'Car tent'], ['PartyTent', 'Party tent'],
      ['Fireplace', 'Fireplace'], ['BarrelHoles_Blue', 'Barrel w/ holes (blue)'], ['BarrelHoles_Red', 'Barrel w/ holes (red)'],
      ['FenceKit', 'Fence kit'], ['WatchtowerKit', 'Watchtower kit'], ['Wreck_UH1Y', 'UH-1Y helicopter wreck'],
    ] },
    { id: 'loot', name: 'Loot Containers', kind: 'loot', items: [
      ['SeaChest', 'Loot chest'], ['WoodenCrate', 'Loot crate'], ['Barrel_Blue', 'Loot barrel (blue)'],
      ['Barrel_Green', 'Loot barrel (green)'], ['MediumTent', 'Stash tent'],
    ] },
    { id: 'weapons', name: 'Weapons', kind: 'item', items: [
      ['AKM', 'AKM'], ['AK74', 'AK-74'], ['M4A1', 'M4-A1'], ['SKS', 'SKS'], ['Mosin9130', 'Mosin 91/30'],
      ['Winchester70', 'Winchester 70'], ['CZ61', 'CZ61 Skorpion'], ['FNX45', 'FNX-45'], ['Glock19', 'Glock 19'],
      ['MKII', 'MK-II'], ['IJ70', 'IJ-70'], ['Izh18', 'Izh-18'], ['Mp133Shotgun', 'MP-133'], ['Crossbow_Wood', 'Crossbow'],
      ['Mag_AKM_30Rnd', 'AKM 30rd mag'], ['Mag_STANAG_30Rnd', 'STANAG 30rd mag'], ['Ammo_762x39', '7.62x39 ammo'],
      ['Ammo_556x45', '5.56x45 ammo'], ['Ammo_762x54', '7.62x54R ammo'], ['Ammo_45ACP', '.45 ACP ammo'], ['Ammo_12gaPellets', '12ga pellets'],
    ] },
    { id: 'clothing', name: 'Clothing & Gear', kind: 'item', items: [
      ['PlateCarrierVest', 'Plate carrier'], ['MilitaryBoots_Black', 'Military boots'], ['BaseballCap_Blue', 'Baseball cap'],
      ['Jeans_Blue', 'Jeans'], ['TShirt_Black', 'T-shirt'], ['HuntingJacket_Brown', 'Hunting jacket'],
      ['GorkaEJacket_Summer', 'Gorka jacket'], ['AliceBag_Camo', 'Alice pack'], ['MountainBag_Green', 'Mountain bag'],
      ['CoyoteBag_Brown', 'Coyote bag'], ['Ushanka_Black', 'Ushanka'], ['BallisticHelmet_Green', 'Ballistic helmet'],
      ['NVGoggles', 'NV goggles'], ['WorkingGloves_Black', 'Work gloves'],
    ] },
    { id: 'medical', name: 'Medical', kind: 'item', items: [
      ['BandageDressing', 'Bandage'], ['Rag', 'Rag'], ['Morphine', 'Morphine'], ['Epinephrine', 'Epinephrine'],
      ['SalineBag', 'Saline bag'], ['SalineBagIV', 'Saline IV bag'], ['TetracyclineAntibiotics', 'Tetracycline'],
      ['CharcoalTablets', 'Charcoal tablets'], ['VitaminBottle', 'Vitamins'], ['BloodBagIV', 'Blood bag'],
      ['FirstAidKit', 'First aid kit'], ['Splint', 'Splint'], ['DisinfectantSpray', 'Disinfectant spray'],
    ] },
    { id: 'food', name: 'Food & Drink', kind: 'item', items: [
      ['SodaCan_Cola', 'Cola'], ['SodaCan_Pipsi', 'Pipsi'], ['WaterBottle', 'Water bottle'], ['Canteen', 'Canteen'],
      ['TunaCan', 'Tuna'], ['BakedBeansCan', 'Baked beans'], ['SpaghettiCan', 'Spaghetti'], ['PeachesCan', 'Peaches'],
      ['Apple', 'Apple'], ['Pear', 'Pear'], ['Rice', 'Rice'], ['PowderedMilk', 'Powdered milk'],
    ] },
    { id: 'tools', name: 'Tools & Misc', kind: 'item', items: [
      ['Hammer', 'Hammer'], ['Hatchet', 'Hatchet'], ['Pliers', 'Pliers'], ['Crowbar', 'Crowbar'], ['Shovel', 'Shovel'],
      ['Flashlight', 'Flashlight'], ['Battery9V', '9V battery'], ['Compass', 'Compass'], ['ChernarusMap', 'Chernarus map'],
      ['NailBox', 'Nail box'], ['DuctTape', 'Duct tape'], ['Rope', 'Rope'], ['Binoculars', 'Binoculars'],
      ['Matchbox', 'Matchbox'], ['Lockpick', 'Lockpick'], ['Notebook', 'Notebook'], ['Pen_Black', 'Pen'], ['Paper', 'Paper'],
    ] },
    { id: 'vehicles', name: 'Vehicles', kind: 'vehicle', items: [
      ['OffroadHatchback', 'Offroad Hatchback'], ['CivilianSedan', 'Civilian Sedan'], ['Hatchback_02', 'Hatchback 02'],
      ['Sedan_02', 'Sedan 02'], ['Truck_01_Covered', 'V3S Truck (covered)'], ['Offroad_02', 'Offroad 02'],
    ] },
    { id: 'infected', name: 'Infected', kind: 'infected', items: [
      ['ZmbM_CitizenASkinny_Blue', 'Citizen (male)'], ['ZmbF_CitizenANormal_Beige', 'Citizen (female)'],
      ['ZmbM_PolicemanFat', 'Policeman'], ['ZmbM_SoldierNormal', 'Soldier'], ['ZmbM_FirefighterNormal', 'Firefighter'],
      ['ZmbF_NurseFat', 'Nurse'], ['ZmbM_priestPopSkinny', 'Priest'], ['ZmbM_HermitSkinny_Beige', 'Hermit'],
      ['ZmbM_PatrolNormal_Summer', 'Patrol soldier'], ['ZmbF_JournalistNormal_Blue', 'Journalist'],
    ] },
    { id: 'animals', name: 'Animals', kind: 'animal', items: [
      ['Animal_CervusElaphus', 'Red deer'], ['Animal_CapreolusCapreolus', 'Roe deer'], ['Animal_CanisLupus_Grey', 'Grey wolf'],
      ['Animal_UrsusArctos', 'Brown bear'], ['Animal_SusScrofa', 'Wild boar'], ['Animal_BosTaurus_Brown', 'Cow'],
      ['Animal_GallusGallusDomesticus', 'Chicken'],
    ] },
    { id: 'npcs', name: 'NPC Survivors', kind: 'npc', items: [
      ['SurvivorM_Mirek', 'Mirek'], ['SurvivorM_Boris', 'Boris'], ['SurvivorM_Denis', 'Denis'], ['SurvivorM_Cyril', 'Cyril'],
      ['SurvivorM_Elias', 'Elias'], ['SurvivorM_Hassan', 'Hassan'], ['SurvivorM_Oliver', 'Oliver'], ['SurvivorM_Rolf', 'Rolf'],
      ['SurvivorF_Eva', 'Eva'], ['SurvivorF_Frida', 'Frida'], ['SurvivorF_Irena', 'Irena'], ['SurvivorF_Judy', 'Judy'],
    ] },
    { id: 'events', name: 'Event Spawn Points', kind: 'event', items: [
      ['StaticHeliCrash', 'Helicopter crash site'], ['StaticMilitaryConvoy', 'Military convoy'],
      ['StaticPoliceSituation', 'Police situation'], ['StaticContaminatedArea', 'Contaminated area'],
      ['StaticBuilder', 'Custom static event'],
    ] },
  ];

  /* ---- quest NPCs: the vanilla survivor characters and ready-made outfits (all class names checked against DayZ 1.30) ---- */
  DS.NPC_CHARACTERS = [
    'SurvivorM_Mirek', 'SurvivorM_Boris', 'SurvivorM_Cyril', 'SurvivorM_Denis', 'SurvivorM_Elias', 'SurvivorM_Francis', 'SurvivorM_Guo',
    'SurvivorM_Hassan', 'SurvivorM_Indar', 'SurvivorM_Jose', 'SurvivorM_Kaito', 'SurvivorM_Lewis', 'SurvivorM_Manua', 'SurvivorM_Niki',
    'SurvivorM_Oliver', 'SurvivorM_Peter', 'SurvivorM_Quinn', 'SurvivorM_Rolf', 'SurvivorM_Seth', 'SurvivorM_Taiki',
    'SurvivorF_Eva', 'SurvivorF_Frida', 'SurvivorF_Gabi', 'SurvivorF_Helga', 'SurvivorF_Irena', 'SurvivorF_Judy', 'SurvivorF_Keiko',
    'SurvivorF_Linda', 'SurvivorF_Maria', 'SurvivorF_Naomi', 'SurvivorF_Baty',
  ];
  DS.NPC_HANDS = ['Mosin9130', 'CZ527', 'Winchester70', 'Repeater', 'Ruger1022', 'Izh18', 'SKS', 'AKM', 'M4A1', 'MP5K', 'Izh43Shotgun', 'Mp133Shotgun',
    'Glock19', 'MakarovIJ70', 'FNX45', 'FirefighterAxe', 'WoodAxe', 'Hatchet', 'Machete', 'KukriKnife', 'Crowbar', 'Shovel', 'FieldShovel', 'Pitchfork',
    'Sickle', 'Hammer', 'Pipe', 'Flashlight', 'BandageDressing'];
  DS.NPC_OUTFITS = [
    { id: 'survivor', name: 'Survivor (casual)', gear: ['TShirt_Grey', 'Jeans_Blue', 'Sneakers_Gray', 'BaseballCap_Blue'], hands: '' },
    { id: 'hiker', name: 'Hiker', gear: ['HikingJacket_Red', 'CargoPants_Beige', 'HikingBootsLow_Grey', 'BoonieHat_Tan'], hands: '' },
    { id: 'hunter', name: 'Hunter', gear: ['HuntingJacket_Brown', 'HunterPants_Brown', 'HikingBoots_Brown', 'BoonieHat_Olive'], hands: 'Mosin9130' },
    { id: 'soldier_ru', name: 'Soldier (Russian)', gear: ['GorkaEJacket_Summer', 'GorkaPants_Summer', 'MilitaryBoots_Black', 'GorkaHelmet', 'SmershVest'], hands: 'AKM' },
    { id: 'soldier_us', name: 'Soldier (US)', gear: ['USMCJacket_Woodland', 'USMCPants_Woodland', 'CombatBoots_Brown', 'Mich2001Helmet', 'PlateCarrierVest', 'TacticalGloves_Green'], hands: 'M4A1' },
    { id: 'police', name: 'Police officer', gear: ['PoliceJacket', 'PolicePants', 'PoliceCap', 'CombatBoots_Black', 'PoliceVest'], hands: 'Glock19' },
    { id: 'medic', name: 'Paramedic', gear: ['ParamedicJacket_Crimson', 'ParamedicPants_Crimson', 'Sneakers_White', 'SurgicalGloves_Blue'], hands: '' },
    { id: 'doctor', name: 'Doctor', gear: ['MedicalScrubsShirt_Green', 'MedicalScrubsPants_Green', 'MedicalScrubsHat_Green', 'SurgicalGloves_Green', 'LeatherShoes_Black'], hands: '' },
    { id: 'worker', name: 'Construction worker', gear: ['JumpsuitJacket_Blue', 'JumpsuitPants_Blue', 'WorkingBoots_Yellow', 'ConstructionHelmet_Yellow', 'WorkingGloves_Yellow'], hands: 'Hammer' },
    { id: 'farmer', name: 'Farmer', gear: ['Shirt_GreenCheck', 'Breeches_Browncheck', 'Wellies_Green', 'FlatCap_Brown'], hands: 'Pitchfork' },
    { id: 'trader', name: 'Trader', gear: ['QuiltedJacket_Black', 'CargoPants_Black', 'LeatherShoes_Brown', 'FlatCap_GreyCheck', 'AviatorGlasses'], hands: '' },
    { id: 'bandit', name: 'Bandit', gear: ['BomberJacket_Black', 'Jeans_Black', 'MilitaryBoots_Black', 'BalaclavaMask_Black'], hands: 'Izh43Shotgun' },
    { id: 'hazmat', name: 'Hazmat', gear: ['NBCJacketYellow', 'NBCPantsYellow', 'NBCBootsYellow', 'NBCGlovesYellow', 'NBCHoodYellow'], hands: '' },
    { id: 'sniper', name: 'Sniper (ghillie)', gear: ['GhillieSuit_Woodland', 'M65Jacket_Olive', 'CargoPants_Green', 'MilitaryBoots_Brown'], hands: 'CZ527' },
  ];

  /* ---- prefabs: placed as a group.  parts: [class, kind, dx, dz, yaw] ---- */
  DS.PREFABS = [
    { id: 'camp', name: 'Survivor Camp', desc: 'Tents, fire and stash barrels', parts: [
      ['LargeTent', 'prop', 0, 0, 0], ['MediumTent', 'prop', 9, 4, 40], ['Fireplace', 'prop', 4, -6, 0],
      ['Barrel_Green', 'loot', -5, 5, 0], ['Barrel_Blue', 'loot', -6, 7, 20], ['WoodenCrate', 'loot', 6, -3, 15],
    ] },
    { id: 'checkpoint', name: 'Military Checkpoint', desc: 'Two guard boxes, container, barrels', parts: [
      ['Land_Mil_GuardBox_Green', 'building', -8, 0, 90], ['Land_Mil_GuardBox_Green', 'building', 8, 0, 270],
      ['Land_Container_1Bo', 'building', 0, 14, 0], ['Barrel_Red', 'prop', -4, -6, 0], ['Barrel_Red', 'prop', 4, -6, 0],
      ['SeaChest', 'loot', 0, 8, 0],
    ] },
    { id: 'cache', name: 'Hidden Cache', desc: 'Chest guarded by barrels', parts: [
      ['SeaChest', 'loot', 0, 0, 0], ['Barrel_Blue', 'prop', 2.5, 1, 0], ['Barrel_Green', 'prop', -2.5, 1.5, 0],
      ['WoodenCrate', 'prop', 0, -3, 30],
    ] },
    { id: 'crash', name: 'Crash Site', desc: 'Heli wreck with scattered loot', parts: [
      ['Wreck_UH1Y', 'prop', 0, 0, 30], ['Barrel_Red', 'prop', 8, 3, 0], ['SeaChest', 'loot', -7, -4, 0],
    ] },
  ];

  /* ---- loot crate classes offered in quest rewards ---- */
  DS.CRATES = ['SeaChest', 'WoodenCrate', 'Barrel_Blue', 'Barrel_Green', 'Barrel_Red', 'Barrel_Yellow', 'MediumTent', 'LargeTent'];

  DS.KILL_PRESETS = [
    ['Any infected', '@infected'], ['Any animal', '@animal'], ['Other players', '@player'],
    ['Military infected', 'ZmbM_SoldierNormal'], ['Police infected', 'ZmbM_PolicemanFat'],
    ['Wolves', 'Animal_CanisLupus_Grey'], ['Bears', 'Animal_UrsusArctos'], ['Deer', 'Animal_CervusElaphus'],
  ];

  DS.STATS = [
    ['heal', 'Full heal (health, blood, shock, stop bleeding)'],
    ['health', 'Add health'],
    ['blood', 'Add blood'],
    ['shock', 'Add shock'],
    ['water', 'Add water'],
    ['energy', 'Add energy (food)'],
  ];

  /* ---- quest node schema ----------------------------------------------------
   field types: text, area, num, bool, select, pos, cls (one class), classes (list), items (class+qty list), code */
  DS.NODE_CATS = {
    trigger: { name: 'Triggers (start)', color: '#22c55e' },
    objective: { name: 'Objectives', color: '#3b82f6' },
    reward: { name: 'Rewards & Outcomes', color: '#f59e0b' },
    logic: { name: 'Flow Logic', color: '#a78bfa' },
  };

  const POS = (k, label, help) => ({ k, t: 'pos', label: label || 'Location', help, def: { x: 0, y: 0, z: 0, ref: null } });
  const NOMARK = () => ({ k: 'nomark', t: 'bool', label: 'Hide the marker (no map or on-screen marker — keep the location a secret)', def: false });

  DS.NODE_TYPES = {
    start: { cat: 'trigger', title: 'Quest Available', icon: '▶',
      desc: 'The quest is offered to every player automatically, optionally after a delay.',
      fields: [{ k: 'delay', t: 'num', label: 'Delay after player joins (sec)', def: 0, min: 0 }],
      sum: (p) => (p.delay > 0 ? `After ${p.delay}s online` : 'Immediately on join') },
    trg_zone: { cat: 'trigger', title: 'Enter Area', icon: '◎',
      desc: 'Starts when a player walks into a circular area.',
      fields: [POS('pos', 'Area centre', 'Pick a spot on the map or link to a placed object.'), { k: 'radius', t: 'num', label: 'Radius (m)', def: 50, min: 1 },
        { k: 'text', t: 'area', label: 'Message shown on entry', def: '' }],
      sum: (p) => `Within ${p.radius}m of ${posText(p.pos)}` },
    trg_npc: { cat: 'trigger', title: 'Talk to NPC', icon: '☺',
      desc: 'Spawns a quest-giver survivor. The player walks up, looks at them and presses the interact key (F) to start a conversation; accepting starts the quest.',
      fields: [{ k: 'npc', t: 'cls', label: 'NPC character (face / body)', def: 'SurvivorM_Mirek', list: 'dz-npcs' },
        { k: 'name', t: 'text', label: 'NPC display name', def: 'Mirek' },
        { k: 'outfit', t: 'outfit', label: 'Outfit', def: '' },
        { k: 'gear', t: 'items', label: 'Clothing and gear (worn / carried)', def: [] },
        { k: 'hands', t: 'cls', label: 'Item in hands (weapon or tool)', def: '', list: 'dz-hands' },
        POS('pos', 'NPC position'), { k: 'yaw', t: 'num', label: 'Facing (deg)', def: 0, min: 0, max: 360 },
        { k: 'radius', t: 'num', label: 'Interaction distance (m)', def: 4, min: 1 },
        { k: 'nomark', t: 'bool', label: 'Hide from the map (players must find this NPC themselves)', def: false },
        { k: 'cond', t: 'cond', label: 'Only appears while', def: null, kinds: 'world', help: 'Leave on “Always” for an NPC that is always there. Otherwise the NPC shows up and leaves on its own, e.g. a faction leader once a server variable is set, or a night trader.' },
        { k: 'dialog', t: 'dialog', label: 'Conversation', def: null },
        { k: 'text', t: 'area', label: 'Quick greeting (used when no conversation is written)', def: 'Hey, survivor. I need a favour...' }],
      sum: (p) => `${p.name || p.npc} @ ${posText(p.pos)}` },
    trg_item: { cat: 'trigger', title: 'Has Item', icon: '▣',
      desc: 'Starts when a player is carrying a specific item.',
      fields: [{ k: 'item', t: 'cls', label: 'Item class', def: '' }, { k: 'count', t: 'num', label: 'Amount', def: 1, min: 1 }],
      sum: (p) => `${p.count}x ${p.item || '?'}` },
    trg_time: { cat: 'trigger', title: 'Time Based', icon: '⏱',
      desc: 'Starts after time online, or during a given in-game hour.',
      fields: [{ k: 'mode', t: 'select', label: 'Mode', def: 'after', opts: [['after', 'Seconds after joining'], ['hour', 'During in-game hour']] },
        { k: 'seconds', t: 'num', label: 'Seconds', def: 60, min: 0, show: (p) => p.mode === 'after' },
        { k: 'hour', t: 'num', label: 'Hour (0-23)', def: 12, min: 0, max: 23, show: (p) => p.mode === 'hour' }],
      sum: (p) => (p.mode === 'hour' ? `In-game hour ${p.hour}` : `${p.seconds}s after join`) },
    trg_cond: { cat: 'trigger', title: 'Condition Met', icon: '◈',
      desc: 'Starts when a condition holds: a server variable, the time of day, the weather, server uptime, or the player’s own state (bleeding, sick…).',
      fields: [{ k: 'cond', t: 'cond', label: 'Starts when', def: { kind: 'weather', stat: 'storm', op: 'is' } }],
      sum: (p) => (DS.Cond ? DS.Cond.text(p.cond) : '') },

    obj_kill: { cat: 'objective', title: 'Kill Targets', icon: '✖',
      desc: 'Kill infected, animals or players. Use @infected for any zombie.',
      fields: [{ k: 'classes', t: 'classes', label: 'Target classes', def: ['@infected'] },
        { k: 'count', t: 'num', label: 'How many', def: 10, min: 1 },
        { k: 'area', t: 'bool', label: 'Only count kills inside an area', def: false },
        Object.assign(POS('pos', 'Area centre'), { show: (p) => p.area }),
        { k: 'radius', t: 'num', label: 'Area radius (m)', def: 150, min: 1, show: (p) => p.area },
        Object.assign(NOMARK(), { show: (p) => p.area }),
        { k: 'text', t: 'text', label: 'Objective text (optional)', def: '' }],
      sum: (p) => `Kill ${p.count} × ${(p.classes || []).join(', ') || 'infected'}` },
    obj_travel: { cat: 'objective', title: 'Travel To', icon: '➤',
      desc: 'Reach a location.',
      fields: [POS('pos', 'Destination'), { k: 'radius', t: 'num', label: 'Arrival radius (m)', def: 15, min: 1 },
        { k: 'text', t: 'text', label: 'Objective text (optional)', def: '' }, NOMARK()],
      sum: (p) => `Reach ${posText(p.pos)} (±${p.radius}m)` },
    obj_collect: { cat: 'objective', title: 'Retrieve Item', icon: '⬇',
      desc: 'Find items and carry them in the inventory.',
      fields: [{ k: 'item', t: 'cls', label: 'Item class', def: '' }, { k: 'count', t: 'num', label: 'Amount', def: 1, min: 1 },
        { k: 'consume', t: 'bool', label: 'Take items away when complete', def: false },
        { k: 'text', t: 'text', label: 'Objective text (optional)', def: '' }],
      sum: (p) => `${p.count}× ${p.item || '?'}` },
    obj_deliver: { cat: 'objective', title: 'Deliver Item', icon: '⬆',
      desc: 'Bring items to a location. Items are removed on delivery.',
      fields: [{ k: 'item', t: 'cls', label: 'Item class', def: '' }, { k: 'count', t: 'num', label: 'Amount', def: 1, min: 1 },
        POS('pos', 'Delivery point'), { k: 'radius', t: 'num', label: 'Radius (m)', def: 8, min: 1 },
        { k: 'text', t: 'text', label: 'Objective text (optional)', def: '' }, NOMARK()],
      sum: (p) => `${p.count}× ${p.item || '?'} → ${posText(p.pos)}` },
    obj_survive: { cat: 'objective', title: 'Survive', icon: '♥',
      desc: 'Stay alive for a duration (quest can restart on death).',
      fields: [{ k: 'seconds', t: 'num', label: 'Duration (sec)', def: 300, min: 1 },
        { k: 'text', t: 'text', label: 'Objective text (optional)', def: '' }],
      sum: (p) => `${p.seconds}s` },
    obj_cond: { cat: 'objective', title: 'Meet a Condition', icon: '✚',
      desc: 'An objective that is done when the player is in a state - e.g. “Stop the bleeding”, “Cure your sickness”, “Get your blood above 4000” - or when the world is (night, storm, a server variable).',
      fields: [{ k: 'text', t: 'text', label: 'Objective text (shown in the tracker)', def: 'Stop the bleeding' },
        { k: 'cond', t: 'cond', label: 'Done when', def: { kind: 'player', stat: 'bleeding', op: 'not' } }],
      sum: (p) => p.text || (DS.Cond ? DS.Cond.text(p.cond) : '') },

    rew_crate: { cat: 'reward', title: 'Spawn Loot Crate', icon: '▤',
      desc: 'Creates a container filled with items at a location.',
      fields: [{ k: 'crate', t: 'select', label: 'Container', def: 'SeaChest', opts: DS.CRATES.map((c) => [c, c]) },
        POS('pos', 'Spawn at'), { k: 'items', t: 'items', label: 'Contents', def: [], chance: true },
        { k: 'lifetime', t: 'num', label: 'Remove after (sec, 0 = never)', def: 1800, min: 0 },
        { k: 'text', t: 'text', label: 'Message to player', def: 'A supply crate has appeared!' }],
      sum: (p) => `${p.crate} (${(p.items || []).length} items) @ ${posText(p.pos)}` },
    rew_item: { cat: 'reward', title: 'Give Items', icon: '✚',
      desc: 'Adds items directly to the player (drops at feet if full).',
      fields: [{ k: 'items', t: 'items', label: 'Items', def: [] }],
      sum: (p) => (p.items || []).map((i) => `${i.n}× ${i.c}`).join(', ') || 'nothing' },
    act_setvar: { cat: 'reward', title: 'Set Server Variable', icon: '⚑',
      desc: 'Changes a server-wide variable that every player shares and that survives restarts. Use it to unlock quests, change conversations or make NPCs appear for everyone.',
      fields: [{ k: 'var', t: 'var', label: 'Variable name', def: '' },
        { k: 'varOp', t: 'select', label: 'Change', def: 'set', opts: [['set', 'Set to'], ['add', 'Add'], ['sub', 'Subtract'], ['toggle', 'Toggle 0 ↔ 1']] },
        { k: 'varValue', t: 'num', label: 'Value', def: 1, show: (p) => p.varOp !== 'toggle' },
        { k: 'text', t: 'area', label: 'Message to the player (optional)', def: '' }],
      sum: (p) => `${p.var || '?'} ${{ set: '=', add: '+=', sub: '-=', toggle: 'toggle' }[p.varOp] || '='}${p.varOp === 'toggle' ? '' : ' ' + p.varValue}` },
    act_fx: { cat: 'reward', title: 'Turn Effect On / Off', icon: '✦',
      desc: 'Switches a placed effect (sound, particles, light) on or off for everyone - e.g. start the alarm when the quest begins. The switch survives restarts.',
      fields: [{ k: 'fx', t: 'fxpick', label: 'Effect', def: '' },
        { k: 'on', t: 'select', label: 'Switch', def: 'on', opts: [['on', 'On'], ['off', 'Off']] }],
      sum: (p) => { const o = DS.store.obj(p.fx); return `${o ? o.label || 'effect' : '?'} ${p.on === 'off' ? 'off' : 'on'}`; } },
    rew_notify: { cat: 'reward', title: 'Show Message', icon: '✉',
      desc: 'Pop-up notification (and optional chat line).',
      fields: [{ k: 'title', t: 'text', label: 'Title', def: 'Quest' }, { k: 'text', t: 'area', label: 'Message', def: '' },
        { k: 'chat', t: 'bool', label: 'Also post to chat', def: true }],
      sum: (p) => p.title || '' },
    rew_modifier: { cat: 'reward', title: 'Player Modifier', icon: '♚',
      desc: 'Heal or change a player stat.',
      fields: [{ k: 'stat', t: 'select', label: 'Effect', def: 'heal', opts: DS.STATS },
        { k: 'amount', t: 'num', label: 'Amount', def: 50, show: (p) => p.stat !== 'heal' }],
      sum: (p) => (p.stat === 'heal' ? 'Full heal' : `${p.stat} ${p.amount >= 0 ? '+' : ''}${p.amount}`) },
    rew_spawn: { cat: 'reward', title: 'Spawn Entities', icon: '☠',
      desc: 'Spawn infected / animals / vehicles (ambushes, boss fights).',
      fields: [{ k: 'cls', t: 'cls', label: 'Class', def: 'ZmbM_SoldierNormal', list: 'infected' },
        { k: 'count', t: 'num', label: 'Amount', def: 5, min: 1 }, POS('pos', 'Spawn centre'),
        { k: 'radius', t: 'num', label: 'Scatter radius (m)', def: 15, min: 0 },
        { k: 'text', t: 'text', label: 'Message to player', def: '' }],
      sum: (p) => `${p.count}× ${p.cls || '?'}` },
    rew_script: { cat: 'reward', title: 'Custom Script', icon: '{ }',
      desc: 'Raw Enforce Script run on the server. Variables: player (PlayerBase), pos (vector).',
      fields: [{ k: 'code', t: 'code', label: 'Enforce Script', def: '// player.MessageStatus("Hello!");' }],
      sum: () => 'Enforce script' },

    logic_delay: { cat: 'logic', title: 'Wait', icon: '⏳', desc: 'Pause the flow for some seconds.',
      fields: [{ k: 'seconds', t: 'num', label: 'Seconds', def: 10, min: 1 }], sum: (p) => `${p.seconds}s` },
    logic_join: { cat: 'logic', title: 'Wait For All', icon: '⋈',
      desc: 'Continues only after ALL incoming branches have finished.', fields: [], sum: () => 'AND join' },
    logic_wait: { cat: 'logic', title: 'Wait Until', icon: '⧗',
      desc: 'Holds the quest here until a condition holds - e.g. only continue during a thunderstorm, at night, or once a server variable is set. Players do not see it; use “Meet a Condition” to show a step in the tracker.',
      fields: [{ k: 'cond', t: 'cond', label: 'Continue when', def: { kind: 'time', value: 0, to: 0.25 } }],
      sum: (p) => (DS.Cond ? DS.Cond.text(p.cond) : '') },
    end: { cat: 'logic', title: 'Quest Complete', icon: '★', desc: 'Ends the quest and marks it completed.',
      fields: [{ k: 'text', t: 'text', label: 'Completion message', def: 'Quest complete!' }], sum: (p) => p.text || '' },
  };

  // every objective can be a bonus: shown as optional, never needed to finish the quest
  Object.values(DS.NODE_TYPES).forEach((T) => {
    if (T.cat !== 'objective') return;
    T.fields.unshift({ k: 'optional', t: 'bool', label: 'Bonus objective (optional — the quest can be finished without it)', def: false });
    const sum = T.sum;
    T.sum = (p) => (p.optional ? 'BONUS · ' : '') + (sum ? sum(p) : '');
  });

  function posText(pos) {
    if (!pos) return '?';
    const r = DS.resolvePos ? DS.resolvePos(pos) : pos;
    return `${Math.round(r.x)}, ${Math.round(r.z)}${pos.ref ? ' ⛓' : ''}`;
  }
  DS.posText = posText;
})();
