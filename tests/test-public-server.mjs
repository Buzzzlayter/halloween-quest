import test from "node:test";
import assert from "node:assert/strict";
import {validPublicIPv4} from "../scripts/start-public.mjs";

test("public launcher accepts public IPv4 only and rejects private and documentation ranges",()=>{
  assert.equal(validPublicIPv4("8.8.8.8"),true);
  for(const address of ["","example.com","127.0.0.1","192.168.1.4","10.2.3.4","172.16.2.1",
    "100.64.2.1","169.254.1.1","198.51.100.1","203.0.113.2","224.0.0.1","8.8.8.999","::1"])
    assert.equal(validPublicIPv4(address),false,address);
});
