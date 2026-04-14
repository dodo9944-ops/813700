require('dotenv').config();

const serviceKey = process.env.SEOUL_API_KEY;

async function test() {
  const url = `http://openapi.seoul.go.kr:8088/${serviceKey}/json/TbPublicWifiInfo/1/5/`;

  const res = await fetch(url);
  const data = await res.json();

  console.log(JSON.stringify(data, null, 2));
}

test();
