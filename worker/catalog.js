export const PRODUCTS = Object.freeze({diamonds_100:100,diamonds_500:500,diamonds_1200:1200,diamonds_2500:2500});
export const STYLES = Object.freeze([
 {id:'courier',name:'Kai',currency:'free',cost:0},{id:'skater',name:'Mira',currency:'free',cost:0},
 {id:'sprinter',name:'Zuri',currency:'coins',cost:1200},{id:'robot',name:'Bolt',currency:'coins',cost:3500},
 {id:'astronaut',name:'Nova',currency:'diamonds',cost:100},{id:'neon',name:'Flux',currency:'diamonds',cost:150}
]);
export const ITEMS = Object.freeze([{id:'magnet',currency:'coins',cost:150},{id:'shield',currency:'coins',cost:200},{id:'coins_1000',currency:'diamonds',cost:10}]);
// No previous shipped spin table existed. These versioned launch odds are public
// configuration, rather than a claim that the owner supplied these exact odds.
export const SPIN_OUTCOMES = Object.freeze([
 {id:'coins_100',kind:'coins',amount:100,probability:.35},
 {id:'coins_300',kind:'coins',amount:300,probability:.25},
 {id:'magnet_1',kind:'item',item_id:'magnet',amount:1,probability:.15},
 {id:'shield_1',kind:'item',item_id:'shield',amount:1,probability:.15},
 {id:'character_sprinter',kind:'character',style_id:'sprinter',probability:.06},
 {id:'character_robot',kind:'character',style_id:'robot',probability:.03},
 {id:'character_astronaut',kind:'character',style_id:'astronaut',probability:.01}
]);
export function catalog(){return {version:1,products:Object.entries(PRODUCTS).map(([id,diamonds],i)=>({id,diamonds,base_price_usd:[.99,3.99,7.99,14.99][i]})),styles:STYLES,items:ITEMS,spin_outcomes:SPIN_OUTCOMES,spin_cost:20,limits:{free_daily:1,ad_daily:2,revives_per_run:1},daily_timezone:'UTC',duplicate_character_compensation:{kind:'coins',amount:300}};}
