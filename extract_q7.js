const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launchPersistentContext('/tmp/leetcode-test-profile', {
    headless: false,
    channel: 'chrome'
  });
  
  const page = await browser.newPage();
  
  await page.goto('https://leetcode.com/problems/best-time-to-buy-and-sell-stock/solutions/?envType=study-plan-v2&envId=top-interview-150', {
    waitUntil: 'networkidle',
    timeout: 60000
  });
  
  await page.waitForTimeout(5000);
  
  const solutions = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('a[href*="/solutions/"]').forEach(a => {
      const title = a.textContent.trim();
      if (title.length > 15 && title.length < 200 && 
          !title.includes('LeetCode') && 
          !title.includes('Solution') &&
          !title.includes('Video')) {
        let votes = 0;
        const parent = a.closest('div, article, section');
        if (parent) {
          const voteText = parent.textContent.match(/(\d+(?:\.\d+)?[KM]?)\s*vote/i);
          if (voteText) {
            const voteStr = voteText[1];
            if (voteStr.endsWith('K')) votes = parseFloat(voteStr) * 1000;
            else if (voteStr.endsWith('M')) votes = parseFloat(voteStr) * 1000000;
            else votes = parseInt(voteStr);
          }
        }
        items.push({ title, href: a.href, votes });
      }
    });
    return items.sort((a, b) => b.votes - a.votes).slice(0, 3);
  });
  
  console.log('Top solutions:', JSON.stringify(solutions, null, 2));
  
  if (solutions.length > 0) {
    await page.goto(solutions[0].href, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    const content = await page.evaluate(() => {
      const selectors = [
        'article',
        '[class*="content"]',
        '[class*="solution"]',
        '[class*="answer"]',
        'div[role="article"]'
      ];
      
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.innerText.trim();
        }
      }
      
      return document.body.innerText.trim();
    });
    
    console.log('Content length:', content.length);
    console.log('First 500 chars:', content.substring(0, 500));
    
    fs.writeFileSync('/tmp/q7_top_solution.txt', content);
    console.log('Saved to /tmp/q7_top_solution.txt');
  }
  
  await browser.close();
})();
