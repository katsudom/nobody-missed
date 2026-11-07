// FAKE demo data. Every person, address and policy number below is invented.
// The backend has no customer table, so the board looks people up here by victimHandle,
// or (for injected synthetic rows) by the kind of issue in the message text.

export type IssueKey = 'oxygen' | 'insulin' | 'flood' | 'collapse' | 'mobility' | 'baby' | 'utilities' | 'other';

export const ISSUES: { key: IssueKey; label: string; match: RegExp }[] = [
  { key: 'oxygen', label: 'Medical · oxygen', match: /oxygen|ventilator|dialysis/i },
  { key: 'insulin', label: 'Medical · insulin', match: /insulin|fridge/i },
  { key: 'flood', label: 'Flooding', match: /water coming|flood|trapped/i },
  { key: 'collapse', label: 'Structural damage', match: /collaps|tree fell|roof/i },
  { key: 'mobility', label: 'Mobility', match: /wheelchair|walker|elevator/i },
  { key: 'baby', label: 'Infant / family', match: /baby|infant|family of/i },
  { key: 'utilities', label: 'No power / water', match: /no power|no water|power is out|power out/i },
  { key: 'other', label: 'General check', match: /.*/s },
];

export const issueFor = (text: string) => ISSUES.find((i) => i.match.test(text)) ?? ISSUES[ISSUES.length - 1];

export type Holder = {
  handle: string;
  name: string;
  age: number;
  address: string;
  policy: string;
  issue: IssueKey;
  text: string; // what they'd text the line (used by /victim-sim)
};

const H = (n: number) => `+1214555${String(100 + n)}`;
const raw: Omit<Holder, 'handle'>[] = [
  { name: 'Maria Alvarez', age: 78, address: '2214 Willow Bend Dr, Plano', policy: 'Home', issue: 'oxygen', text: "Power out since last night, I'm on oxygen and my backup battery is almost dead" },
  { name: 'Harold Whitfield', age: 81, address: '908 Oak Hollow Ln, Richardson', policy: 'Home + Auto', issue: 'oxygen', text: 'Power out, my wife is on oxygen, she is 80' },
  { name: 'Dolores Benton', age: 76, address: '4410 Creekview Ct, Garland', policy: 'Home', issue: 'oxygen', text: "I'm on a ventilator at home and the power just went out" },
  { name: 'Tom & Lena Brandt', age: 58, address: '1630 Mesa Verde Dr, Dallas', policy: 'Home + Auto', issue: 'insulin', text: 'Insulin needs refrigeration, no power since yesterday' },
  { name: 'Aisha Rahman', age: 34, address: '77 Lakeshore Pl, Irving', policy: 'Renters', issue: 'insulin', text: 'My insulin is in a dead fridge and I have no ice' },
  { name: 'Gary Nguyen', age: 62, address: '5102 Pecan Grove Rd, Mesquite', policy: 'Home', issue: 'insulin', text: 'Need insulin kept cold, fridge is dead' },
  { name: 'Dev Patel', age: 31, address: '310 Trinity Bend Rd, Dallas', policy: 'Renters', issue: 'flood', text: 'Wife is 8 months pregnant, road is flooded and water is coming in' },
  { name: 'Carla Mendez', age: 45, address: '2208 Riverside Ct, Fort Worth', policy: 'Home + Auto', issue: 'flood', text: 'Water coming into the house, we are trapped upstairs' },
  { name: 'Walt & June Pruitt', age: 69, address: '14 Cedar Run, Rowlett', policy: 'Home', issue: 'flood', text: 'Flooding on the first floor, we are trapped and cannot get out' },
  { name: 'Calvin Ortiz', age: 52, address: '8821 Elm Fork Dr, Carrollton', policy: 'Home', issue: 'collapse', text: 'Tree fell on the roof, part of the ceiling collapsed. Family is safe' },
  { name: 'Janelle Brooks', age: 40, address: '615 Heritage St, Denton', policy: 'Home + Auto', issue: 'collapse', text: 'Roof is torn open and rain is pouring into the kids room' },
  { name: 'Frank Kowalski', age: 66, address: '3305 Bluebonnet Ln, Lewisville', policy: 'Home', issue: 'collapse', text: 'A tree came through the garage wall, ceiling collapsed' },
  { name: 'Ruth Okafor', age: 84, address: '1200 Park Tower #4B, Dallas', policy: 'Condo', issue: 'mobility', text: 'Lives alone, I use a wheelchair and the elevator is out' },
  { name: 'Marcus Hill', age: 47, address: '901 Cityplace Ave #12, Dallas', policy: 'Renters', issue: 'mobility', text: 'I use a wheelchair and the elevator is out, no power on my floor' },
  { name: 'Edith Larkin', age: 88, address: '52 Garden Terrace, Plano', policy: 'Home', issue: 'mobility', text: "I can't use the stairs with my walker and the elevator is out" },
  { name: 'Priya Nair', age: 29, address: '1789 Maple Crest, Frisco', policy: 'Renters', issue: 'baby', text: 'Family of 3 with a baby, power is out and it is getting cold' },
  { name: 'The Delgado family', age: 36, address: '422 Sunrise Blvd, McKinney', policy: 'Home + Auto', issue: 'baby', text: 'Family of 5 with a baby, power is out' },
  { name: 'Kim & Joon Park', age: 33, address: '9 Willowbrook Ct, Allen', policy: 'Home', issue: 'baby', text: 'We have an infant and a toddler, no formula left and the store is closed' },
  { name: 'Hank Wilder', age: 71, address: '6604 Prairie Wind Dr, Rockwall', policy: 'Home', issue: 'utilities', text: 'No power and no water since yesterday' },
  { name: 'Joyce Tran', age: 55, address: '2970 Greenbriar Ln, Arlington', policy: 'Home + Auto', issue: 'utilities', text: 'No water since the storm, and the power is out' },
  { name: 'Owen Gallagher', age: 38, address: '118 Station St, Grapevine', policy: 'Condo', issue: 'utilities', text: 'No power for two days, phone is at 5%' },
  { name: 'Samir Haddad', age: 27, address: '40 Elm St #3, Dallas', policy: 'Renters', issue: 'other', text: 'Just checking if shelters are open' },
  { name: 'Bea Thompson', age: 60, address: '707 Main St, Waxahachie', policy: 'Home', issue: 'other', text: 'Is anyone coming to check on my street? We are fine for now' },
  { name: 'Luis Ortega', age: 43, address: '1555 Bell Ave, Plano', policy: 'Home + Auto', issue: 'other', text: 'Where do I file a claim for a fence that came down?' },
];

export const HOLDERS: Holder[] = raw.map((h, i) => ({ ...h, handle: H(i) }));
const byHandle = new Map(HOLDERS.map((h) => [h.handle, h]));

function hash(s: string) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return x >>> 0;
}

export type Person = { name: string; age?: number; address?: string; policy?: string; policyNo?: string; issue: string };

// Real handle match first; otherwise pick a stable fake policyholder whose issue fits the text.
export function personFor(r: { id: bigint; victimHandle: string; rawText: string }): Person {
  const issue = issueFor(r.rawText);
  let h = byHandle.get(r.victimHandle);
  if (!h) {
    const pool = HOLDERS.filter((x) => x.issue === issue.key);
    if (pool.length === 0) return { name: r.victimHandle, issue: issue.label };
    h = pool[hash(`${r.victimHandle}:${r.id}`) % pool.length];
  }
  const policyNo = `SF-${String(1000000 + (hash(h.handle) % 9000000))}`;
  return { name: h.name, age: h.age, address: h.address, policy: h.policy, policyNo, issue: issue.label };
}

// Stable fake map position (0..1) for a request.
export function mapPos(id: bigint): [number, number] {
  const a = hash(`x${id}`), b = hash(`y${id}`);
  return [(a % 10000) / 10000, (b % 10000) / 10000];
}
