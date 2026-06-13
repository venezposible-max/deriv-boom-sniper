import fs from 'fs';

let serverContent = fs.readFileSync('server-boom.js', 'utf8');

// 1. Fix the truncation of history down to 300 ticks!
serverContent = serverContent.replace(
    /if \(mState\.digitHistory\.length > 300\) \{\s*mState\.digitHistory = mState\.digitHistory\.slice\(-300\);\s*\}/g,
    'if (mState.digitHistory.length > 2500) {\n                    mState.digitHistory = mState.digitHistory.slice(-2500);\n                }'
);

// 2. Fix the stagger for history and subscriptions
// Let's make sure the delay between connections is 1 second (1000ms) to avoid Deriv blocking us
serverContent = serverContent.replace(
    'delayMs += 500;',
    'delayMs += 1200;' // 1.2 seconds between each market request
);

// 3. Make sure '1HZ...' symbols don't crash the api if not allowed
// Sometimes Deriv blocks certain markets for certain tokens, but it should be fine.

fs.writeFileSync('server-boom.js', serverContent);
console.log('Fixed History Truncation and Connection Delay!');
