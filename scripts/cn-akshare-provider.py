#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time


def disable_proxy_by_default():
    if os.environ.get("CN_MARKET_DATA_USE_PROXY") == "1":
        return
    for key in (
        "http_proxy",
        "https_proxy",
        "all_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
    ):
        os.environ.pop(key, None)


def fail(message, code=1):
    print(json.dumps({"error": message}, ensure_ascii=False), file=sys.stderr)
    raise SystemExit(code)


disable_proxy_by_default()

try:
    import akshare as ak
    import requests
except Exception:
    fail("Python package 'akshare' is not installed. Run: pip install akshare pandas")


def parse_args():
    parser = argparse.ArgumentParser(description="Fetch China market data via AkShare")
    parser.add_argument("command", choices=["bars", "quote", "profile", "sectors", "etfs"])
    parser.add_argument("--symbol")
    parser.add_argument("--asset-type", choices=["STOCK", "ETF"], default="STOCK")
    parser.add_argument("--from-date")
    parser.add_argument("--to-date")
    return parser.parse_args()


def compact_date(value):
    if not value:
        return value
    return value.replace("-", "")


def frame_to_bars(df):
    if df is None or df.empty:
        return []

    bars = []
    for _, row in df.iterrows():
        date = str(row.get("日期", "")).strip()
        if not date:
            continue
        bars.append(
            {
                "date": date,
                "open": float(row.get("开盘", 0) or 0),
                "high": float(row.get("最高", 0) or 0),
                "low": float(row.get("最低", 0) or 0),
                "close": float(row.get("收盘", 0) or 0),
                "volume": int(float(row.get("成交量", 0) or 0)),
            }
        )
    return bars


def eastmoney_secid(symbol):
    if symbol.startswith(("5", "6", "9")):
        return f"1.{symbol}"
    return f"0.{symbol}"


def eastmoney_session():
    session = requests.Session()
    session.trust_env = False
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Referer": "https://quote.eastmoney.com/",
            "Connection": "close",
        }
    )
    return session


def fetch_eastmoney_bars(symbol, from_date, to_date):
    start = compact_date(from_date) or "19900101"
    end = compact_date(to_date) or "20991231"
    params = {
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
        "ut": "7eea3edcaed734bea9cbfc24409ed989",
        "klt": "101",
        "fqt": "1",
        "beg": start,
        "end": end,
        "secid": eastmoney_secid(symbol),
    }

    hosts = (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://82.push2his.eastmoney.com/api/qt/stock/kline/get",
        "https://52.push2his.eastmoney.com/api/qt/stock/kline/get",
    )

    last_error = None
    for host in hosts:
        for attempt in range(3):
            try:
                res = eastmoney_session().get(
                    host,
                    params=params,
                    timeout=30,
                )
                res.raise_for_status()
                data = res.json()
                klines = data.get("data", {}).get("klines") or []
                if not klines:
                    raise ValueError("empty klines response")
                bars = []
                for item in klines:
                    parts = item.split(",")
                    if len(parts) < 6:
                        continue
                    bars.append(
                        {
                            "date": parts[0],
                            "open": float(parts[1]),
                            "close": float(parts[2]),
                            "high": float(parts[3]),
                            "low": float(parts[4]),
                            "volume": int(float(parts[5] or 0)),
                        }
                    )
                return bars
            except Exception as exc:
                last_error = exc
                time.sleep(2 + attempt * 2)

    raise last_error


def fetch_eastmoney_clist(fs):
    params = {
        "pn": "1",
        "pz": "5000",
        "po": "1",
        "np": "1",
        "ut": "bd1d9ddb04089700cf9c27f6f7426281",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",
        "fs": fs,
        "fields": "f12,f14",
    }
    hosts = (
        "https://push2.eastmoney.com/api/qt/clist/get",
        "https://17.push2.eastmoney.com/api/qt/clist/get",
        "https://40.push2.eastmoney.com/api/qt/clist/get",
    )
    last_error = None
    for host in hosts:
        for attempt in range(3):
            try:
                res = eastmoney_session().get(host, params=params, timeout=20)
                res.raise_for_status()
                data = res.json()
                return data.get("data", {}).get("diff") or []
            except Exception as exc:
                last_error = exc
                time.sleep(1 + attempt)
    raise last_error


def fetch_bars(symbol, asset_type, from_date, to_date):
    start = compact_date(from_date)
    end = compact_date(to_date)
    try:
        bars = fetch_eastmoney_bars(symbol, from_date, to_date)
        if bars:
            return bars
    except Exception as exc:
        print(
            json.dumps(
                {"warning": f"eastmoney direct fetch failed: {exc}"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )

    if asset_type == "ETF":
        df = ak.fund_etf_hist_em(
            symbol=symbol,
            period="daily",
            start_date=start,
            end_date=end,
            adjust="qfq",
        )
    else:
        df = ak.stock_zh_a_hist(
            symbol=symbol,
            period="daily",
            start_date=start,
            end_date=end,
            adjust="qfq",
        )
    return frame_to_bars(df)


def fetch_quote(symbol, asset_type):
    try:
        if asset_type == "ETF":
            df = ak.fund_etf_spot_em()
        else:
            df = ak.stock_zh_a_spot_em()
        row = df[df["代码"].astype(str) == symbol]
        if not row.empty:
            return float(row.iloc[0]["最新价"])
    except Exception:
        pass

    bars = fetch_bars(symbol, asset_type, "20200101", "20991231")
    return bars[-1]["close"] if bars else None


def fetch_profile(symbol, asset_type):
    if asset_type == "ETF":
        try:
            df = ak.fund_etf_spot_em()
            row = df[df["代码"].astype(str) == symbol]
            name = str(row.iloc[0]["名称"]) if not row.empty else symbol
        except Exception:
            name = symbol
        return {
            "shortName": name,
            "longName": name,
            "sector": "ETF",
            "industry": "ETF",
            "marketCap": None,
            "pe": None,
            "forwardPe": None,
            "eps": None,
            "dividendYield": None,
            "fiftyTwoWeekHigh": None,
            "fiftyTwoWeekLow": None,
            "avgVolume": None,
            "description": "",
        }

    try:
        df = ak.stock_info_a_code_name()
        row = df[df["code"].astype(str) == symbol]
        name = str(row.iloc[0]["name"]) if not row.empty else symbol
    except Exception:
        name = symbol

    return {
        "shortName": name,
        "longName": name,
        "sector": "A股",
        "industry": "A股",
        "marketCap": None,
        "pe": None,
        "forwardPe": None,
        "eps": None,
        "dividendYield": None,
        "fiftyTwoWeekHigh": None,
        "fiftyTwoWeekLow": None,
        "avgVolume": None,
        "description": "",
    }


def read_sector_frame(fetcher, category, fallback_fs):
    try:
        df = fetcher()
    except Exception as exc:
        print(
            json.dumps(
                {"warning": f"eastmoney {category} sector fetch failed: {exc}"},
                ensure_ascii=False,
            ),
            file=sys.stderr,
        )
        try:
            rows = fetch_eastmoney_clist(fallback_fs)
            return [
                {
                    "category": category,
                    "name": str(row.get("f14", "")).strip(),
                    "code": str(row.get("f12", "")).strip(),
                }
                for row in rows
                if str(row.get("f14", "")).strip()
            ]
        except Exception as fallback_exc:
            print(
                json.dumps(
                    {
                        "warning": (
                            f"eastmoney {category} direct fallback failed: "
                            f"{fallback_exc}"
                        )
                    },
                    ensure_ascii=False,
                ),
                file=sys.stderr,
            )
            return []

    sectors = []
    if df is None or df.empty:
        return sectors

    for _, row in df.iterrows():
        name = str(row.get("板块名称", "") or row.get("名称", "")).strip()
        if not name:
            continue
        sectors.append(
            {
                "category": category,
                "name": name,
                "code": str(row.get("板块代码", "") or row.get("代码", "")).strip(),
            }
        )
    return sectors


def fetch_sectors():
    sectors = []
    sectors.extend(
        read_sector_frame(
            ak.stock_board_industry_name_em,
            "industry",
            "m:90+t:2",
        )
    )
    sectors.extend(
        read_sector_frame(
            ak.stock_board_concept_name_em,
            "concept",
            "m:90+t:3",
        )
    )
    return sectors


def parse_number(value):
    if value is None:
        return None
    try:
        text = str(value).replace(",", "").strip()
        if not text or text in ("-", "nan", "None"):
            return None
        return float(text)
    except Exception:
        return None


def first_number(row, keys):
    for key in keys:
        value = parse_number(row.get(key))
        if value is not None:
            return value
    return None


def fetch_etfs():
    df = ak.fund_etf_spot_em()
    if df is None or df.empty:
        return []

    etfs = []
    for _, row in df.iterrows():
        code = str(row.get("代码", "")).strip()
        name = str(row.get("名称", "")).strip()
        if not code or not name:
            continue
        amount = first_number(row, ["成交额", "成交额(元)", "成交额(万)", "金额"])
        volume = first_number(row, ["成交量", "成交量(手)", "成交量(股)"])
        market_value = first_number(row, ["总市值", "流通市值", "基金规模", "规模"])
        etfs.append(
            {
                "ticker": code,
                "name": name,
                "latestPrice": first_number(row, ["最新价", "最新净值"]),
                "amount": amount,
                "volume": volume,
                "marketValue": market_value,
                "rankValue": market_value or amount or volume or 0,
            }
        )
    return etfs


def main():
    args = parse_args()
    symbol = args.symbol.strip() if args.symbol else ""

    if args.command not in ("sectors", "etfs") and not symbol:
        fail("--symbol is required for bars, quote, and profile")

    if args.command == "bars":
        payload = fetch_bars(symbol, args.asset_type, args.from_date, args.to_date)
    elif args.command == "quote":
        payload = {"price": fetch_quote(symbol, args.asset_type)}
    elif args.command == "sectors":
        payload = fetch_sectors()
    elif args.command == "etfs":
        payload = fetch_etfs()
    else:
        payload = fetch_profile(symbol, args.asset_type)

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
