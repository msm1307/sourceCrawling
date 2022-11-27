const axios = require("axios");
const puppeteer = require("puppeteer");
const fs = require("fs");

let errArray = [];
let success = 0;

(async function startCrawling() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ["--window-size=1920,1080"],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 1920,
    height: 1080,
  });

  const PROJECT_FOLDER_NAME = await page.evaluate(() => prompt("생성하실 폴더명을 입력해주세요.", ""));
  const URL = await page.evaluate(() => prompt("소스를 가져올 url을 입력해주세요.", ""));

  await page.goto(URL);

  const mainHostUrl = await page.evaluate(() => {
    return window.location.origin;
  });

  await createMainPage(page, PROJECT_FOLDER_NAME);
  await createScriptFile(page, PROJECT_FOLDER_NAME, mainHostUrl);
  await createImgFile(page, PROJECT_FOLDER_NAME, mainHostUrl);
  await createCssFile(page, PROJECT_FOLDER_NAME, mainHostUrl);
  await page.waitForTimeout(5000);
  console.log(`총 ${success}개의 파일을 생성 완료했습니다.`);
  console.log(`총 ${errArray.length}개의 파일을 생성 실패했습니다.`);
  if (errArray.length) {
    console.log(`실패 URL \n--------------------------------------------------------------------------`);
    errArray.forEach((value) => {
      console.log(value);
    });
    console.log("--------------------------------------------------------------------------");
  }
  await browser.close();
})();

async function createMainPage(page, PROJECT_FOLDER_NAME) {
  const url = await page.evaluate(() => {
    return window.location.href;
  });

  let mainPagePath = await page.evaluate(() => {
    return window.location.pathname;
  });
  mainPagePath = `${PROJECT_FOLDER_NAME}/site${mainPagePath.slice(0, mainPagePath.lastIndexOf("/") + 1)}`;

  await download(url, mainPagePath, "index.html");
}

async function createScriptFile(page, PROJECT_FOLDER_NAME, mainHostUrl) {
  const scriptURLs = await page.$$eval("script", (links) =>
    links.filter((link) => link.src !== "").map((link) => link.src)
  );
  await filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, scriptURLs);
  // await page.waitForTimeout(1000);
}

async function createImgFile(page, PROJECT_FOLDER_NAME, mainHostUrl) {
  const imgURLs = await page.$$eval("img", (links) => links.filter((link) => link.src !== "").map((link) => link.src));
  await filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, imgURLs);
}

async function createCssFile(page, PROJECT_FOLDER_NAME, mainHostUrl) {
  const mainPageCssURLs = await page.$$eval("link", (links) =>
    links.filter((link) => link.rel === "stylesheet").map((link) => link.href)
  );
  const downloadUrl = await scrapeUrlData(mainPageCssURLs, mainHostUrl);
  await filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, downloadUrl);
}

async function filteringDownload(PROJECT_FOLDER_NAME, mainHostUrl, urls) {
  //url에서 폴더 경로만 추출
  for (let url of urls) {
    if (!url.includes(mainHostUrl) || url.includes("DATA/") || url.includes("data:image")) {
      continue;
    }
    if (url.includes("?")) {
      url = url.slice(0, url.lastIndexOf("?"));
    }
    let folderPath = url.replace(mainHostUrl, "");
    folderPath = PROJECT_FOLDER_NAME + folderPath.slice(0, folderPath.lastIndexOf("/") + 1); // 폴더경로/ 까지 잘라줌
    let fileName = url.slice(url.lastIndexOf("/") + 1); // 파일명.확장자만 추출
    await download(url, folderPath, fileName);
  }
}

async function download(url, folderPath, fileName) {
  await axios({
    url,
    method: "GET",
    responseType: "stream",
  })
    .then((res) => {
      // console.log(res.data.req.host); // 호스트 url
      // console.log(res.data.req.path); // 현재 pathName
      // console.log(res.data.responseUrl); // 현재 url
      createFolder(folderPath);
      return res;
    })
    .then((res) => {
      createFile(res, folderPath, fileName);
      success++;
    })
    .catch((error) => {
      console.log(`${error.config.url} 존재하지 않는 url 입니다.`);
      errArray.push(error.config.url);
    });
}

async function createFolder(folderPath) {
  fs.readdir(folderPath, (err) => {
    // uploads 폴더 없으면 생성
    if (err) {
      fs.mkdirSync(folderPath, { recursive: true });
    }
  });
}
async function createFile(res, folderPath, fileName) {
  const filePath = folderPath + fileName;
  fs.readFile(filePath, (err) => {
    if (err) {
      res.data
        .pipe(fs.createWriteStream(filePath))
        .on("finish", function () {
          console.log(filePath, "파일생성 완료");
        })
        .on("error", function (err) {
          console.error(err);
          createFile(res, folderPath, fileName);
        });
    }
  });
}

function pathFiltering(url, mainHostUrl, nowUrlPath) {
  if (url.includes(mainHostUrl)) {
    return url;
  } // 필요한가?
  if (url[0] === "/") {
    return mainHostUrl + url;
  } else if (url.includes("../")) {
    let path = nowUrlPath.slice(0, nowUrlPath.lastIndexOf("/")); // 파일명.확장자 없애기
    let count = url.split("../").length - 1; // ../ 몇번 들어갔는지 카운트
    for (let i = 0; i < count; i++) {
      path = path.slice(0, path.lastIndexOf("/"));
    }
    path = `${path}/${url}`;
    return path.replace(/\.\.\//g, "");
  } else {
    let path = nowUrlPath.slice(0, nowUrlPath.lastIndexOf("/") + 1);
    if (url.includes("./")) {
      path.replace("./", "");
    }
    return `${path + url}`;
  }
}

async function scrapeImportData(urls, mainHostUrl) {
  let moveUrl = [...urls];
  for await (const url of urls) {
    await axios({
      url,
      method: "GET",
    }).then((res) => {
      let contents = res.data;
      const nowUrlPath = res.config.url;
      if (contents.includes("@import url")) {
        contents = contents.matchAll(/@import url\(['"]?(.*?)['"]?\)/g);
        Array.from(contents, (x) => moveUrl.push(pathFiltering(x[1], mainHostUrl, nowUrlPath)));
      }
    });
  }
  return moveUrl;
}

async function scrapeUrlData(urls, mainHostUrl) {
  const moveUrls = await scrapeImportData(urls, mainHostUrl);
  let downloadUrl = [...moveUrls];
  for await (const url of moveUrls) {
    await axios({
      url,
      method: "GET",
    }).then((res) => {
      let contents = res.data;
      const nowUrlPath = res.config.url;
      if (contents.includes("url")) {
        contents = contents.matchAll(/url\(['"]?(.*?)['"]?\)/g);
        Array.from(contents, (x) => downloadUrl.push(pathFiltering(x[1], mainHostUrl, nowUrlPath)));
      }
    });
  }
  downloadUrl = [...new Set(downloadUrl)];
  return downloadUrl;
}
