const assert=require('node:assert/strict'),fs=require('node:fs');
const db=JSON.parse(fs.readFileSync('data/route-timetables.json','utf8'));
assert.equal(db.schemaVersion,1);assert.ok(db.records.length>=4);
for(const r of db.records){assert.ok(r.operator&&r.route&&r.bound);assert.deepEqual(Object.keys(r.days).sort(),['saturday','sunday_public_holiday','weekday']);assert.ok(r.source.url.startsWith('https://'));assert.match(r.source.lastVerified,/^\d{4}-\d{2}-\d{2}$/);assert.ok(r.source.effectiveDate);}
const regular=db.records.find(x=>x.operator==='KMB'&&x.route==='1'&&x.bound==='O');assert.equal(regular.days.weekday.first,'05:35');assert.ok(regular.days.weekday.periods.length>1);
const special=db.records.find(x=>x.kind==='special');assert.deepEqual(special.days.weekday.departures,['07:10','07:15']);
console.log(`Passed: ${db.records.length} timetable records validated by direction, day type, source and dates.`);
