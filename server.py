"""
知识图谱 Web 平台 - 动态后端
替代 http.server，实时查询 Neo4j 返回数据
"""
import http.server
import json
import os
import re
import sys
import urllib.parse
from neo4j import GraphDatabase

# ============ Neo4j 配置 ============
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://192.168.3.27:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PWD = os.environ.get("NEO4J_PWD", "zysoft@2024")

# ============ 空壳实体黑名单 ============
SHELL_NAMES = {
    "鉴别诊断", "诊断标准", "危险分层",
    "预后良好", "预后不良", "预后不佳",
    "一般治疗", "药物治疗", "定期随访",
}

# ============ 维度关系映射 ============
REL_MAP = {
    "Symptom": "has_symptom",
    "Sign": "has_sign",
    "Exam": "requires_exam",
    "LabTest": "requires_lab_test",
    "Medication": "treated_by_medication",
    "Procedure": "treated_by_procedure",
    "RiskFactor": "has_risk_factor",
    "Complication": "may_cause_complication",
    "DifferentialDiagnosis": "differentiates_from",
    "RiskStratification": "has_risk_stratification",
    "Prognosis": "has_prognosis",
    "FollowUp": "has_follow_up",
    "TreatmentPlan": "has_treatment_plan",
    "DiagnosisCriteria": "has_diagnostic_criteria",
    "Etiology": "has_etiology",
    "Epidemiology": "has_epidemiology",
    "Pathophysiology": "has_pathophysiology",
}

EXCLUDE_REL = [
    'supported_by_evidence', 'based_on_guideline',
    'belongs_to_category', 'belongs_to_subcategory',
    'has_category', 'has_subcategory',
]

driver = None

def get_driver():
    global driver
    if driver is None:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PWD))
    return driver


def query_disease_list():
    """获取所有疾病列表"""
    d = get_driver()
    with d.session() as sess:
        results = sess.run("""
            MATCH (d:Disease)
            RETURN d.code as code, d.name as name, d.parentCode as parent
            ORDER BY d.parentCode, d.code
        """)
        return [dict(r) for r in results]


def query_disease_full(code):
    """获取单个疾病的完整17维度数据 + 二跳展开"""
    d = get_driver()
    with d.session() as sess:
        # 基本信息
        info_r = sess.run("""
            MATCH (d:Disease {code: $code})
            RETURN d.code as code, d.name as name, d.parentCode as parent,
                   d.description as desc, d.name_en as name_en
        """, code=code).single()
        if not info_r:
            return None

        info = {
            "code": info_r["code"],
            "name": info_r["name"],
            "parent": info_r["parent"],
            "desc": (info_r["desc"] or "")[:300],
            "name_en": info_r["name_en"] or "",
        }

        # 17维度 + 二跳
        dimensions = {}
        for dim, rel in REL_MAP.items():
            results = sess.run(f"""
                MATCH (d:Disease {{code: $code}})-[:{rel}]->(n)
                RETURN DISTINCT n.code as ncode, n.name as name, n.preferred_name as pref
                ORDER BY n.name LIMIT 30
            """, code=code)
            items = []
            seen = set()
            for r in results:
                name = r["pref"] or r["name"] or r["ncode"] or "N/A"
                if name in SHELL_NAMES or name in seen:
                    continue
                seen.add(name)
                item = {"name": name, "code": r["ncode"]}

                # TreatmentPlan 二跳
                if dim == "TreatmentPlan" and r["ncode"]:
                    item["sub_medication"] = []
                    item["sub_procedure"] = []
                    try:
                        sub_meds = sess.run("""
                            MATCH (tp:KGNode {code: $tp_code})-[:includes_medication]->(m)
                            RETURN DISTINCT m.code as code, m.name as name, m.preferred_name as pref
                            ORDER BY m.name LIMIT 15
                        """, tp_code=r["ncode"])
                        for sm in sub_meds:
                            n = sm["pref"] or sm["name"] or sm["code"]
                            item["sub_medication"].append({"name": n, "code": sm["code"]})

                        sub_procs = sess.run("""
                            MATCH (tp:KGNode {code: $tp_code})-[:includes_procedure]->(p)
                            RETURN DISTINCT p.code as code, p.name as name, p.preferred_name as pref
                            ORDER BY p.name LIMIT 15
                        """, tp_code=r["ncode"])
                        for sp in sub_procs:
                            n = sp["pref"] or sp["name"] or sp["code"]
                            item["sub_procedure"].append({"name": n, "code": sp["code"]})
                    except Exception:
                        pass

                # Medication 二跳
                if dim == "Medication" and r["ncode"]:
                    item["sub_medication"] = []
                    try:
                        sub_meds = sess.run("""
                            MATCH (m:KGNode {code: $med_code})-[:has_specific_medication]->(s)
                            RETURN DISTINCT s.code as code, s.name as name, s.preferred_name as pref
                            ORDER BY s.name LIMIT 15
                        """, med_code=r["ncode"])
                        for sm in sub_meds:
                            n = sm["pref"] or sm["name"] or sm["code"]
                            item["sub_medication"].append({"name": n, "code": sm["code"]})
                    except Exception:
                        pass

                items.append(item)
            dimensions[dim] = items

        # 关系统计
        rel_stats = sess.run("""
            MATCH (d:Disease {code: $code})-[r]->(n)
            WHERE NOT type(r) IN $excl
            RETURN type(r) as rel, n.name as name, labels(n) as lbl
            ORDER BY type(r)
        """, code=code, excl=EXCLUDE_REL)
        relations_summary = [dict(r) for r in rel_stats]

        # 证据数
        ev_cnt = sess.run("""
            MATCH (d:Disease {code: $code})-[:supported_by_evidence]->(e:Evidence)
            RETURN count(e) as cnt
        """, code=code).single()["cnt"]

        return {
            "info": info,
            "dimensions": dimensions,
            "relations_summary": relations_summary,
            "evidence_count": ev_cnt,
        }


def query_global_stats():
    """全局统计"""
    d = get_driver()
    with d.session() as sess:
        total_nodes = sess.run("MATCH (n:KGNode) RETURN count(n) as cnt").single()["cnt"]
        total_rels = sess.run("""
            MATCH ()-[r]->() WHERE NOT type(r) IN $excl RETURN count(r) as cnt
        """, excl=EXCLUDE_REL).single()["cnt"]
        disease_count = sess.run("MATCH (d:Disease) RETURN count(d) as cnt").single()["cnt"]
        shell_count = 0  # 空壳实体在导出时已过滤

        return {
            "total_nodes": total_nodes,
            "total_relationships": total_rels,
            "disease_count": disease_count,
            "shell_entity_count": shell_count,
        }


class KGHandler(http.server.SimpleHTTPRequestHandler):
    """自定义HTTP处理器：API路由 + 静态文件"""

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API 路由
        if path == '/api/kg/diseases':
            self._json_response(query_disease_list())
            return

        if path == '/api/kg/stats':
            self._json_response(query_global_stats())
            return

        m = re.match(r'^/api/kg/disease/([A-Z0-9\-]+)$', path)
        if m:
            code = m.group(1)
            data = query_disease_full(code)
            if data:
                self._json_response(data)
            else:
                self._json_response({"error": "Disease not found"}, 404)
            return

        # 静态文件
        super().do_GET()

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        # 只打印API请求，静默静态文件
        if args and '/api/' in str(args[0]):
            super().log_message(format, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4001
    # 切换到脚本所在目录（即 kg-test-page）
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.HTTPServer(('0.0.0.0', port), KGHandler)
    print(f"知识图谱动态服务启动: http://0.0.0.0:{port}")
    print(f"Neo4j: {NEO4J_URI}")
    print(f"API: /api/kg/diseases | /api/kg/stats | /api/kg/disease/<code>")
    server.serve_forever()


if __name__ == "__main__":
    main()
