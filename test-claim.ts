import { DEFAULT_CLAIM_RULE, detectLoopClaim } from './packages/domain/src/territory-claim';
const points = [
  {"latitude": 37.3318, "longitude": -122.0311, "at": new Date("2026-09-06T12:26:39.924Z")}, 
  {"latitude": 37.332300000000004, "longitude": -122.0311, "at": new Date("2026-09-06T12:26:54.924Z")}, 
  {"latitude": 37.3328, "longitude": -122.0311, "at": new Date("2026-09-06T12:27:09.924Z")}, 
  {"latitude": 37.3328, "longitude": -122.03059999999999, "at": new Date("2026-09-06T12:27:24.924Z")}, 
  {"latitude": 37.3328, "longitude": -122.03009999999999, "at": new Date("2026-09-06T12:27:39.924Z")}, 
  {"latitude": 37.332300000000004, "longitude": -122.03009999999999, "at": new Date("2026-09-06T12:27:54.924Z")}, 
  {"latitude": 37.3318, "longitude": -122.03009999999999, "at": new Date("2026-09-06T12:28:09.924Z")}, 
  {"latitude": 37.3318, "longitude": -122.03059999999999, "at": new Date("2026-09-06T12:28:24.924Z")}, 
  {"latitude": 37.3318, "longitude": -122.0311, "at": new Date("2026-09-06T12:28:39.924Z")}
];
console.log(detectLoopClaim(points, DEFAULT_CLAIM_RULE));
