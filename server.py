# -*- coding: utf-8 -*-
"""
知识图谱 Web 平台 - 动态后端
替代 http.server，实时查询 Neo4j 返回数据
Redis 缓存层：/zoesoft/zoekgRedis
"""
import http.server
import json
import os
import re
import sys
import time
import datetime
import urllib.parse
from neo4j import GraphDatabase

# ============ Redis 缓存配置 ============

# 读取版本号（单一真相源）
VERSION_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'VERSION')
try:
    # utf-8-sig 自动剥离 BOM（4001整改：防止版本号带 U+FEFF）
    with open(VERSION_FILE, 'r', encoding='utf-8-sig') as f:
        APP_VERSION = f.read().strip()
except Exception:
    APP_VERSION = '0.0.0'

# ============ 标准版本常量（4001整改 2026-09-19）============
SCHEMA_STANDARD_VERSION = 'V4.1'   # 当前执行的专科知识图谱Schema标准
API_VERSION = 'v1.3'               # API版本（与APP_VERSION同源，标注接口代次）
# 解析Skill版本不设硬编码常量：实例上的 skill_version 由查询动态统计（4001整改3.1）

REDIS_HOST = os.environ.get("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.environ.get("REDIS_PORT", "6379"))
CACHE_TTL = int(os.environ.get("CACHE_TTL", "300"))  # 默认5分钟过期

_redis = None
_redis_retry_after = 0
def get_redis():
    global _redis, _redis_retry_after
    if _redis is not None:
        return _redis
    now = time.time()
    if now < _redis_retry_after:
        return None
    try:
        import redis
        # retry=None 关闭 redis-py 8.x 默认重试，避免 Redis 不可达时每次挂起数十秒
        _redis = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True,
                             socket_connect_timeout=1, socket_timeout=1,
                             retry=None, retry_on_error=[])
        _redis.ping()
    except Exception:
        # 连接失败进入 30 秒冷却，避免高频请求反复等待连接超时
        _redis_retry_after = now + 30
        _redis = None
    return _redis

def cache_get(key):
    r = get_redis()
    if r:
        try:
            val = r.get(key)
            return json.loads(val) if val else None
        except Exception:
            return None
    return None

def cache_set(key, data, ttl=CACHE_TTL):
    r = get_redis()
    if r:
        try:
            r.setex(key, ttl, json.dumps(data, ensure_ascii=False))
        except Exception:
            pass

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

# ============ 维度关系映射（17核心 + 2直接扩展 + 3护理直连） ============
REL_MAP = {
    "Symptom": "has_symptom",
    "Sign": "has_sign",
    "RiskFactor": "has_risk_factor",
    "Complication": "has_complication",
    "DifferentialDiagnosis": "has_differential_diagnosis",
    "RiskStratification": "has_risk_stratification",
    "Prognosis": "has_prognosis",
    "FollowUp": "has_followup",
    "TreatmentPlan": "has_treatment_plan",
    "DiagnosisCriteria": "has_diagnostic_criteria",
    "Etiology": "has_etiology",
    "Epidemiology": "has_epidemiology",
    "Pathophysiology": "has_pathophysiology",
    "Evidence": "supported_by_evidence",
    "Guideline": "based_on_guideline",
    "Prevention": "has_prevention",
    "Definition": "has_definition",
    # 护理直连维度（Schema V4.0 护理批次 20260906，Disease 一跳）
    "NursingCarePlan": "has_nursing_care_plan",
    "NursingAssessment": "has_nursing_assessment",
    "NursingDiagnosis": "has_nursing_diagnosis",
}

# Schema V2.x 多跳维度（原一跳直连关系已迁移）
# Schema V4.1：ExamItem/LabItem 经 ExamPlan 中转，Drug/Procedure 经 TreatmentPlan 中转
MULTI_HOP_DIMS = {
    "ExamItem": {
        "chain": ["has_exam_plan", "includes_exam_item"],
        "target_label": "ExamItem"
    },
    "LabItem": {
        "chain": ["has_exam_plan", "includes_lab_item"],
        "target_label": "LabItem"
    },
    "Drug": {
        "chain": ["has_treatment_plan", "includes_drug"],
        "target_label": "Drug"
    },
    "Procedure": {
        "chain": ["has_treatment_plan", "includes_procedure"],
        "target_label": "Procedure"
    },
}

# 三跳维度映射：通过 ExamPlan -> ExamItem/LabItem -> 下级节点
TWO_HOP_DIMS = {
    "ThresholdRule": {
        "rel_chain": [
            {"via": "ExamPlan", "rel_to": "has_exam_plan", "hop2_rel": "includes_exam_item", "hop3_rel": "has_threshold_rule"},
            {"via": "ExamPlan", "rel_to": "has_exam_plan", "hop2_rel": "includes_lab_item", "hop3_rel": "has_threshold_rule"},
        ]
    },
    "ExamObservation": {
        "rel_chain": [
            {"via": "ExamPlan", "rel_to": "has_exam_plan", "hop2_rel": "includes_exam_item", "hop3_rel": "exam_item_has_observation"},
        ]
    },
    "LabSubitem": {
        "rel_chain": [
            {"via": "ExamPlan", "rel_to": "has_exam_plan", "hop2_rel": "includes_lab_item", "hop3_rel": "lab_item_has_subitem"},
        ]
    },
}

# ============ 核心维度口径（前端覆盖度分母的单一事实源） ============
# 20 = 17基础 + 3护理（Schema V4.0 护理批次）。
# Schema 升级新增维度批次时：改 REL_MAP/MULTI_HOP_DIMS + 此列表即可，
# 前端 app.js 启动时经 /api/kg/dimensions 自动拉取，无需改任何前端代码。
CORE_DIM_ORDER = [
    "Symptom", "Sign", "ExamItem", "LabItem", "Drug", "Procedure", "RiskFactor",
    "Complication", "DifferentialDiagnosis", "RiskStratification", "Prognosis", "FollowUp",
    "TreatmentPlan", "DiagnosisCriteria", "Etiology", "Epidemiology", "Pathophysiology",
    "NursingCarePlan", "NursingAssessment", "NursingDiagnosis",
]

# 旧静态快照键名别名（新键 → 旧键）：前端读取旧数据时的兜底映射
DIM_ALIAS = {"ExamItem": "Exam", "LabItem": "LabTest", "Drug": "Medication"}

EXCLUDE_REL = [
    'belongs_to_category', 'belongs_to_subcategory',
    'has_category', 'has_subcategory',
]

# ============ 临床展示名清理 ============
# 前缀模式：去掉 "AMI诊断明细："、"STEMI诊断明细："、"AMI鉴别：" 等
_PREFIX_PATTERNS = [
    'AMI诊断明细：', 'STEMI诊断明细：', 'NSTEMI诊断明细：',
    'AMI鉴别：', 'STEMI鉴别：', 'NSTEMI鉴别：',
    'AMI诊断明细:', 'STEMI诊断明细:', 'NSTEMI诊断明细:',
    'AMI鉴别:', 'STEMI鉴别:', 'NSTEMI鉴别:',
]

def clean_name(node):
    """展示名优先级：display_name > preferred_name > name > code，兜底去前缀"""
    raw = node.get('display_name') or node.get('preferred_name') or node.get('name') or node.get('code') or ''
    for p in _PREFIX_PATTERNS:
        if raw.startswith(p):
            raw = raw[len(p):].strip()
            break
    return raw

def clean_name_from_row(r, pref_key='pref', name_key='name', code_key='code'):
    """从 Neo4j Record 中提取 clean name（兼容旧查询行）：display_name > preferred_name > name > code"""
    raw = r.get('dn') if r.get('dn') else None
    if not raw:
        raw = r[pref_key] if r.get(pref_key) else None
    if not raw:
        raw = r[name_key] if r.get(name_key) else None
    if not raw:
        raw = r[code_key] if r.get(code_key) else 'N/A'
    for p in _PREFIX_PATTERNS:
        if raw.startswith(p):
            raw = raw[len(p):].strip()
            break
    return raw

driver = None

def get_driver():
    global driver
    if driver is None:
        driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PWD))
    return driver


def _active_node_filter(label):
    """生成通用节点有效状态过滤：活跃、草稿；排除退役、替换、无效"""
    return "({n}.status IS NULL OR {n}.status IN ['active','draft'])".format(n=label)


# 标准诊断映射类型优先级：名称完全匹配 > exact > 语义等价/未标记 > broader_fallback（宽口径回退，不作首选）
_MT_PRIORITY = {'exact': 0, '语义等价': 1, None: 2, 'broader_fallback': 3}


def _load_standard_diagnosis_map(tx, disease_codes):
    """批量加载 Disease -> 有效 StandardDiagnosis 映射。
    返回 {disease_code: {name, standard_code, std_uuid, coding_system, mapping_type, is_emr_writable, all: [...]}}。
    首选规则（确定性，不按节点号任意取第一个）：
    1. 标准诊断名与 Disease.name 完全一致；
    2. mapping_type 优先级 exact > 语义等价/未标记 > broader_fallback；
    3. 同级按 standard_code 升序。
    all 数组始终返回该疾病的全部有效映射（多映射不丢数据）。
    """
    if not disease_codes:
        return {}
    rows = tx.run("""
        MATCH (d:Disease)-[r:has_standard_diagnosis]->(s:StandardDiagnosis)
        WHERE d.code IN $codes AND s.valid_flag = 1
          AND """ + _active_node_filter('d') + """ AND """ + _active_node_filter('s') + """
        RETURN d.code AS d_code, d.name AS d_name, s.name AS std_name, s.standard_code AS std_code,
               s.code AS std_uuid, s.coding_system AS coding_system,
               r.mapping_type AS mapping_type, r.is_emr_writable AS is_emr_writable
        ORDER BY d.code, s.standard_code
    """, codes=list(disease_codes))
    grouped = {}
    for r in rows:
        grouped.setdefault(r['d_code'], []).append(r)
    result = {}
    for d_code, recs in grouped.items():
        d_name = (recs[0]['d_name'] or '').strip()
        def _pref_key(r):
            exact_name = 0 if d_name and (r['std_name'] or '').strip() == d_name else 1
            return (exact_name, _MT_PRIORITY.get(r['mapping_type'], 2), r['std_code'] or '')
        recs_sorted = sorted(recs, key=_pref_key)
        top = recs_sorted[0]
        result[d_code] = {
            'name': top['std_name'],
            'standard_code': top['std_code'],
            'std_uuid': top['std_uuid'],
            'coding_system': top['coding_system'],
            'mapping_type': top['mapping_type'],
            'is_emr_writable': top['is_emr_writable'],
            'all': [
                {
                    'name': r['std_name'], 'standard_code': r['std_code'], 'std_uuid': r['std_uuid'],
                    'coding_system': r['coding_system'], 'mapping_type': r['mapping_type'],
                    'is_emr_writable': r['is_emr_writable'],
                } for r in recs_sorted
            ],
        }
    return result


def _build_disease_node_v2(disease_code, disease_name, std_dx_map, role=None, subtype_count=0):
    """构建 V2.0 疾病节点。
    疾病名始终用 Disease 自身名称（display_name > preferred_name > name > code，由调用方传入清洗后名称），
    StandardDiagnosis 仅用于 ICD 编码与标准诊断映射信息，不覆盖疾病名。
    """
    std = std_dx_map.get(disease_code, {})
    node = {
        'code': disease_code,
        'type': 'Disease',
        'diagnostic_role': role or '',
        'name': disease_name or disease_code,
        'icd_code': std.get('standard_code') or '',
        'icd_name': std.get('name') or '',
        'std_uuid': std.get('std_uuid') or '',
        'coding_system': std.get('coding_system') or '',
        'std_mapping_type': std.get('mapping_type') or '',
        'std_diagnoses': std.get('all') or [],
        'subtype_count': subtype_count,
        'children': []
    }
    return node


def query_disease_tree():
    """构建 V2.0 疾病层级树：疾病大类 -> 宽口径疾病/独立疾病 -> 具体分型。
    关系：has_disease, has_clinical_subtype；诊断名/编码来自有效 StandardDiagnosis。
    DiseaseSubcategory 不插入诊断链。Redis 缓存。
    """
    cached = cache_get('kg:disease_tree')
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 1. 查询疾病大类（V2.0 主分类以 CAT- 前缀标识；过滤非 CAT 重复旧分类）
        cat_rows = list(sess.run("""
            MATCH (sp:Specialty)-[:has_category]->(cat:DiseaseCategory)
            WHERE """ + _active_node_filter('sp') + """ AND """ + _active_node_filter('cat') + """
              AND cat.code STARTS WITH 'CAT-'
            RETURN cat.code AS cat_code, cat.name AS cat_name, cat.display_name AS cat_dn,
                   cat.preferred_name AS cat_pref
            ORDER BY cat.name
        """))

        # 2. 查询大类 -> 宽口径/独立疾病（只从 V2.0 CAT- 主分类读取）
        broad_rows = list(sess.run("""
            MATCH (sp:Specialty)-[:has_category]->(cat:DiseaseCategory)-[:has_disease]->(dis:Disease)
            WHERE """ + _active_node_filter('sp') + """ AND """ + _active_node_filter('cat') + """ AND """ + _active_node_filter('dis') + """
              AND cat.code STARTS WITH 'CAT-'
              AND dis.diagnostic_role IN ['broad_diagnosis', 'independent_disease']
            RETURN cat.code AS cat_code, dis.code AS dis_code, dis.name AS dis_name,
                   dis.display_name AS dis_dn, dis.preferred_name AS dis_pref,
                   dis.diagnostic_role AS dis_role, dis.is_diagnosable AS is_diagnosable
            ORDER BY cat.name, dis.name
        """))

        # 3. 查询宽口径疾病 -> 具体分型
        subtype_rows = list(sess.run("""
            MATCH (parent:Disease)-[:has_clinical_subtype]->(sub:Disease)
            WHERE """ + _active_node_filter('parent') + """ AND """ + _active_node_filter('sub') + """
              AND parent.diagnostic_role IN ['broad_diagnosis']
              AND sub.diagnostic_role IN ['clinical_subtype']
            RETURN parent.code AS parent_code, sub.code AS sub_code, sub.name AS sub_name,
                   sub.display_name AS sub_dn, sub.preferred_name AS sub_pref,
                   sub.diagnostic_role AS sub_role
            ORDER BY parent.code, sub.name
        """))

        # 4. 批量加载标准诊断
        all_disease_codes = set()
        for r in broad_rows:
            all_disease_codes.add(r['dis_code'])
        for r in subtype_rows:
            all_disease_codes.add(r['sub_code'])
        std_dx_map = _load_standard_diagnosis_map(sess, all_disease_codes)

        # 5. 构建索引
        cat_map = {}
        for r in cat_rows:
            cat_code = r['cat_code']
            if cat_code not in cat_map:
                cat_map[cat_code] = {
                    'code': cat_code,
                    'name': clean_name_from_row(
                        {'dn': r['cat_dn'], 'pref': r['cat_pref'], 'name': r['cat_name'], 'code': r['cat_code']},
                        'pref', 'name', 'code'),
                    'type': 'DiseaseCategory',
                    'children': []
                }

        broad_map = {}
        cat_broad_order = []
        for r in broad_rows:
            cat_code = r['cat_code']
            dis_code = r['dis_code']
            if cat_code not in cat_map:
                continue
            if dis_code in broad_map:
                continue
            node = _build_disease_node_v2(
                dis_code,
                clean_name_from_row({'dn': r['dis_dn'], 'pref': r['dis_pref'], 'name': r['dis_name'], 'code': r['dis_code']}),
                std_dx_map,
                role=r['dis_role'], subtype_count=0)
            broad_map[dis_code] = node
            cat_broad_order.append((cat_code, dis_code))

        subtype_map = {}
        for r in subtype_rows:
            parent_code = r['parent_code']
            sub_code = r['sub_code']
            if parent_code not in broad_map:
                continue
            subtype_map.setdefault(parent_code, []).append({
                'code': sub_code,
                'name': clean_name_from_row({'dn': r['sub_dn'], 'pref': r['sub_pref'], 'name': r['sub_name'], 'code': r['sub_code']}),
                'role': r['sub_role']
            })

        # 6. 组装树：cat -> broad -> subtype
        for parent_code, subs in subtype_map.items():
            parent_node = broad_map[parent_code]
            parent_node['subtype_count'] = len(subs)
            for sub in subs:
                sub_node = _build_disease_node_v2(
                    sub['code'], sub['name'], std_dx_map,
                    role=sub['role'], subtype_count=0)
                parent_node['children'].append(sub_node)

        for cat_code, dis_code in cat_broad_order:
            broad_node = broad_map[dis_code]
            cat_map[cat_code]['children'].append(broad_node)

        result = list(cat_map.values())
        cache_set('kg:disease_tree', result)
        return result


def _disease_lookup_from_tree(tree=None):
    """从 V2.0 疾病树构建 code -> {name, category, diagnostic_role, icd_code, children} 索引"""
    if tree is None:
        tree = query_disease_tree()
    lookup = {}
    def walk_cat(cat):
        for child in cat.get('children', []):
            walk_disease(child, cat.get('name') or cat.get('code') or '')
    def walk_disease(node, category_name):
        lookup[node['code']] = {
            'name': node.get('name') or node['code'],
            'icd_code': node.get('icd_code') or '',
            'category': category_name,
            'diagnostic_role': node.get('diagnostic_role') or '',
            'children': [c['code'] for c in node.get('children', [])]
        }
        for sub in node.get('children', []):
            walk_disease(sub, category_name)
    for cat in tree:
        walk_cat(cat)
    return lookup


def query_disease_list():
    """获取所有疾病列表（含维度数量、标准诊断、diagnostic_role），Redis缓存。单次查询优化"""
    cached = cache_get('kg:disease_list')
    if cached is not None:
        return cached
    d = get_driver()
    with d.session() as sess:
        # 1. 查询所有有效 Disease 节点
        results = sess.run("""
            MATCH (d:Disease)
            WHERE """ + _active_node_filter('d') + """
            RETURN d.code as code, d.name as name, d.preferred_name as pref, d.display_name as dn,
                   d.diagnostic_role as diagnostic_role,
                   d.diagnosis_level as diagnosis_level, d.is_diagnosable as is_diagnosable,
                   d.parentCode as parent
            ORDER BY d.code
        """)
        disease_list = [dict(r) for r in results]
        disease_codes = [d['code'] for d in disease_list]

        # 2. 批量加载标准诊断
        std_dx_map = _load_standard_diagnosis_map(sess, disease_codes)

        # 3. 单次查询获取所有疾病的维度数量
        rel_types = list(REL_MAP.values())
        dim_by_rel = {v: k for k, v in REL_MAP.items()}
        rows = sess.run("""
            MATCH (d:Disease)-[r]->(n:KGNode)
            WHERE type(r) IN $rel_types AND """ + _active_node_filter('d') + """ AND """ + _active_node_filter('n') + """
            RETURN d.code as code, type(r) as rel, count(DISTINCT n) as cnt
        """, rel_types=rel_types)
        dim_counts = {}
        for r in rows:
            code = r["code"]
            rel = r["rel"]
            dim = dim_by_rel.get(rel)
            if dim:
                if code not in dim_counts:
                    dim_counts[code] = {}
                dim_counts[code][dim] = r["cnt"]

        # Schema V4.1 多跳维度统计（ExamItem/LabItem/Drug/Procedure）
        for dim, cfg in MULTI_HOP_DIMS.items():
            chain = cfg["chain"]
            target_label = cfg["target_label"]
            rows = sess.run(f"""
                MATCH (d:Disease)-[:{chain[0]}]->()-[:{chain[1]}]->(n:{target_label})
                WHERE """ + _active_node_filter('d') + """ AND """ + _active_node_filter('n') + """
                RETURN d.code as code, count(DISTINCT n) as cnt
            """)
            for r in rows:
                code = r["code"]
                if code not in dim_counts:
                    dim_counts[code] = {}
                dim_counts[code][dim] = r["cnt"]

        # 疾病大类名（动态解析：DiseaseCategory -has_disease-> 疾病/分型，最多两级分型；
        # 供前端 dashboard 分组直接使用，新增疾病大类无需改前端前缀映射表）
        cat_rows = sess.run("""
            MATCH (cat:DiseaseCategory)-[:has_disease]->()-[:has_clinical_subtype*0..2]->(dis:Disease)
            WHERE cat.code STARTS WITH 'CAT-'
            RETURN dis.code AS code, cat.name AS cat_name, cat.display_name AS cat_dn,
                   cat.preferred_name AS cat_pref
        """)
        cat_name_map = {}
        for r in cat_rows:
            if r["code"] not in cat_name_map:
                cat_name_map[r["code"]] = clean_name_from_row(
                    {'dn': r['cat_dn'], 'pref': r['cat_pref'], 'name': r['cat_name'], 'code': ''},
                    'pref', 'name', 'code')

        for d in disease_list:
            d["dim_counts"] = dim_counts.get(d["code"], {})
            std = std_dx_map.get(d["code"], {})
            # 疾病名始终用 Disease 自身名称（display_name > preferred_name > name），标准诊断不覆盖
            d["name"] = clean_name_from_row(d) or d["code"]
            d["raw_name"] = d["name"]
            d["icd_code"] = std.get("standard_code") or ""
            d["icd_name"] = std.get("name") or ""
            d["std_uuid"] = std.get("std_uuid") or ""
            d["coding_system"] = std.get("coding_system") or ""
            d["std_mapping_type"] = std.get("mapping_type") or ""
            d["std_diagnoses"] = std.get("all") or []
            d["category_name"] = cat_name_map.get(d["code"], "")

        cache_set('kg:disease_list', disease_list)
        return disease_list


def query_diseases_summary():
    """获取所有疾病的维度实体摘要（用于实体索引构建）"""
    d = get_driver()
    with d.session() as sess:
        diseases = sess.run("""
            MATCH (d:Disease)
            WHERE d.status IS NULL OR d.status <> 'deprecated'
            RETURN d.code as code, d.name as name
            ORDER BY d.code
        """)
        disease_list = [dict(r) for r in diseases]

        result = {}
        for d_info in disease_list:
            code = d_info["code"]
            dims = {}
            for dim, rel in REL_MAP.items():
                rows = sess.run(f"""
                    MATCH (d:Disease {{code: $code}})-[:{rel}]->(n)
                    WHERE (n.status IS NULL OR n.status <> 'deprecated')
                    RETURN DISTINCT n.code as ncode, n.name as name, n.preferred_name as pref,
                       n.display_name as dn, n.name_en as name_en, n.aliases as aliases, n.status as status,
                       n.cdss_dict_id as cdss_dict_id,
                       n.clinical_review_status as clinical_review_status,
                       n.execution_status as execution_status,
                       n.source_section_path as section_path, n.book_page_start as book_start,
                       n.pdf_page_start as pdf_start,
                       COUNT {{ (n)-[:supported_by_evidence]-() }} as evidence_count
                    ORDER BY n.name LIMIT 30
                """, code=code)
                items = []
                seen = set()
                for r in rows:
                    if r.get("status") == "deprecated":
                        continue
                    name = clean_name_from_row(r, 'pref', 'name', 'ncode')
                    if name in SHELL_NAMES or name in seen:
                        continue
                    seen.add(name)
                    aliases = [a for a in (r["aliases"] or []) if a != name]
                    items.append({"name": name, "code": r["ncode"], "name_en": r["name_en"] or "", "aliases": aliases, "status": r.get("status"), "cdss_dict_id": r["cdss_dict_id"] or "", "clinical_review_status": r["clinical_review_status"] or "", "execution_status": r["execution_status"] or "", "evidence_count": r["evidence_count"] or 0, "source_section_path": r["section_path"] or "", "book_page_start": r["book_start"] or "", "pdf_page_start": r["pdf_start"] or ""})
                dims[dim] = items
            result[code] = {"info": d_info, "dimensions": dims}

        return result


def query_disease_full(code):
    """获取单个疾病的完整核心维度数据（20 个核心维度 = 17 基础 + 3 护理） + 二跳展开"""
    d = get_driver()
    with d.session() as sess:
        # 基本信息
        info_r = sess.run("""
            MATCH (d:Disease {code: $code})
            RETURN d.code as code, d.name as name, d.parentCode as parent,
                   d.preferred_name as pref, d.display_name as dn,
                   d.description as desc, d.name_en as name_en,
                   d.diagnostic_role as diagnostic_role, d.diagnosis_level as diagnosis_level,
                   d.is_diagnosable as is_diagnosable
        """, code=code).single()
        if not info_r:
            return None

        # 加载该疾病的标准诊断
        std_dx_map = _load_standard_diagnosis_map(sess, [code])
        std = std_dx_map.get(code, {})

        # 加载分型元信息（诊断角色新旧值双兼容：V2.x 旧值 + Schema V3.0 新值）
        _role = info_r.get("diagnostic_role") or ""
        _role_group = {
            "broad_diagnosis": "broad", "suspected_parent": "broad",
            "clinical_subtype": "subtype", "specific_subtype": "subtype",
            "independent_disease": "independent", "standalone_diagnosis": "independent",
        }.get(_role, "")
        parent_code = None
        subtype_codes = []
        if _role_group == "subtype":
            parent_rs = sess.run("""
                MATCH (parent:Disease)-[:has_clinical_subtype]->(sub:Disease {code: $code})
                WHERE """ + _active_node_filter('parent') + """
                RETURN parent.code AS parent_code LIMIT 1
            """, code=code)
            for pr in parent_rs:
                parent_code = pr['parent_code']
        elif _role_group in ("broad", "independent"):
            sub_rs = sess.run("""
                MATCH (parent:Disease {code: $code})-[:has_clinical_subtype]->(sub:Disease)
                WHERE """ + _active_node_filter('sub') + """
                RETURN sub.code AS sub_code ORDER BY sub.name
            """, code=code)
            subtype_codes = [sr['sub_code'] for sr in sub_rs]

        info = {
            "code": info_r["code"],
            # 疾病名始终用 Disease 自身名称（display_name > preferred_name > name），标准诊断不覆盖
            "name": clean_name_from_row(info_r) or code,
            "raw_name": info_r["name"] or "",
            "icd_code": std.get("standard_code") or "",
            "icd_name": std.get("name") or "",
            "std_uuid": std.get("std_uuid") or "",
            "coding_system": std.get("coding_system") or "",
            "std_mapping_type": std.get("mapping_type") or "",
            "std_diagnoses": std.get("all") or [],
            "diagnostic_role": info_r.get("diagnostic_role") or "",
            "diagnosis_level": info_r.get("diagnosis_level") or "",
            "is_diagnosable": info_r.get("is_diagnosable"),
            "parent": parent_code or info_r.get("parent") or "",
            "subtypes": subtype_codes,
            "desc": (info_r["desc"] or "")[:300],
            "name_en": info_r["name_en"] or "",
        }

        # 核心维度（20 个：17 基础 + 3 护理）+ 二跳
        dimensions = {}

        # Schema V4.1 多跳维度（ExamItem/LabItem/Drug/Procedure）
        for dim, cfg in MULTI_HOP_DIMS.items():
            chain = cfg["chain"]
            target_label = cfg["target_label"]
            results = sess.run(f"""
                MATCH (d:Disease {{code: $code}})-[:{chain[0]}]->(p)-[:{chain[1]}]->(n:{target_label})
                WHERE (n.status IS NULL OR n.status <> 'deprecated')
                RETURN DISTINCT n.code as ncode, n.name as name, n.preferred_name as pref,
                       n.display_name as dn, n.name_en as name_en, n.aliases as aliases,
                       n.status as status, n.maps_to_disease_code as maps_to_disease_code,
                       n.skeleton_slot as skeleton_slot, n.knowledge_layer as knowledge_layer,
                       n.source_section_path as section_path, n.source_type as source_type,
                       n.pdf_page_start as pdf_start, n.pdf_page_end as pdf_end,
                       n.book_page_start as book_start, n.book_page_end as book_end,
                       n.text_anchor as text_anchor,
                       n.definition_text as definition_text, n.original_text as original_text,
                       n.description as description,
                       n.cdss_dict_id as cdss_dict_id,
                       n.clinical_review_status as review_status,
                       COUNT {{ (n)-[:supported_by_evidence]-() }} as evidence_count
                ORDER BY n.name LIMIT 200
            """, code=code)
            items = []
            seen = set()
            for r in results:
                if r.get("status") == "deprecated":
                    continue
                name = clean_name_from_row(r, 'pref', 'name', 'ncode')
                if name in SHELL_NAMES or name in seen:
                    continue
                seen.add(name)
                aliases = [a for a in (r["aliases"] or []) if a != name]
                item = {
                    "name": name, "code": r["ncode"], "name_en": r["name_en"] or "", "aliases": aliases,
                    "status": r.get("status") or "",
                    "maps_to_disease_code": r.get("maps_to_disease_code") or "",
                    "skeleton_slot": r["skeleton_slot"] or "",
                    "knowledge_layer": r["knowledge_layer"] or "",
                    "source_section_path": r["section_path"] or "",
                    "source_type": r["source_type"] or "",
                    "pdf_page_start": r["pdf_start"] or "",
                    "pdf_page_end": r["pdf_end"] or "",
                    "book_page_start": r["book_start"] or "",
                    "book_page_end": r["book_end"] or "",
                    "text_anchor": r["text_anchor"] or "",
                    "definition_text": r["definition_text"] or "",
                    "original_text": r["original_text"] or "",
                    "description": r["description"] or "",
                    "cdss_dict_id": r["cdss_dict_id"] or "",
                    "clinical_review_status": r["review_status"] or "",
                    "evidence_count": r["evidence_count"] or 0,
                }

                # Drug 二跳 — has_specific_drug（药品类别→具体药品）
                if dim == "Drug" and r["ncode"]:
                    item["sub_drug"] = []
                    try:
                        sub_meds = sess.run("""
                            MATCH (m:KGNode {code: $med_code})-[:has_specific_drug]->(s)
                            RETURN DISTINCT s.code as code, s.name as name, s.preferred_name as pref
                            ORDER BY s.name LIMIT 15
                        """, med_code=r["ncode"])
                        for sm in sub_meds:
                            n = clean_name_from_row(sm, 'pref', 'name', 'code')
                            item["sub_drug"].append({"name": n, "code": sm["code"]})
                    except Exception:
                        pass

                # Procedure 二跳 — CDSS 手术字典编码（V4.1）
                if dim == "Procedure" and r["ncode"]:
                    item["std_procedures"] = []
                    try:
                        sp_rs = sess.run("""
                            MATCH (p:Procedure {code: $proc_code})
                            WHERE p.standard_code IS NOT NULL AND p.standard_code <> ''
                            RETURN DISTINCT p.code as code, p.name as name,
                                   p.standard_code as standard_code, p.coding_system as coding_system
                            LIMIT 10
                        """, proc_code=r["ncode"])
                        for sp in sp_rs:
                            item["std_procedures"].append({
                                "name": sp["name"] or "",
                                "code": sp["code"] or "",
                                "standard_code": sp["standard_code"] or "",
                                "coding_system": sp["coding_system"] or "",
                            })
                    except Exception:
                        pass

                items.append(item)
            dimensions[dim] = items

        # 直连维度（13个）
        for dim, rel in REL_MAP.items():
            results = sess.run(f"""
                MATCH (d:Disease {{code: $code}})-[:{rel}]->(n)
                WHERE (n.status IS NULL OR n.status <> 'deprecated')
                RETURN DISTINCT n.code as ncode, n.name as name, n.preferred_name as pref,
                       n.display_name as dn, n.name_en as name_en, n.aliases as aliases,
                       n.status as status, n.maps_to_disease_code as maps_to_disease_code,
                       n.skeleton_slot as skeleton_slot, n.knowledge_layer as knowledge_layer,
                       n.source_section_path as section_path, n.source_type as source_type,
                       n.pdf_page_start as pdf_start, n.pdf_page_end as pdf_end,
                       n.book_page_start as book_start, n.book_page_end as book_end,
                       n.text_anchor as text_anchor,
                       n.definition_text as definition_text, n.original_text as original_text,
                       n.description as description,
                       n.cdss_dict_id as cdss_dict_id,
                       n.clinical_review_status as review_status,
                       n.execution_status as execution_status,
                       n.inference_status as inference_status,
                       n.applicable_stage as applicable_stage,
                       n.assessment_method as assessment_method,
                       n.care_context as care_context,
                       COUNT {{ (n)-[:supported_by_evidence]-() }} as evidence_count
                ORDER BY n.name LIMIT 30
            """, code=code)
            items = []
            seen = set()
            for r in results:
                if r.get("status") == "deprecated":
                    continue
                name = clean_name_from_row(r, 'pref', 'name', 'ncode')
                if name in SHELL_NAMES or name in seen:
                    continue
                seen.add(name)
                aliases = [a for a in (r["aliases"] or []) if a != name]
                item = {
                    "name": name, "code": r["ncode"], "name_en": r["name_en"] or "", "aliases": aliases,
                    "status": r.get("status") or "",
                    "maps_to_disease_code": r.get("maps_to_disease_code") or "",
                    "skeleton_slot": r["skeleton_slot"] or "",
                    "knowledge_layer": r["knowledge_layer"] or "",
                    "source_section_path": r["section_path"] or "",
                    "source_type": r["source_type"] or "",
                    "pdf_page_start": r["pdf_start"] or "",
                    "pdf_page_end": r["pdf_end"] or "",
                    "book_page_start": r["book_start"] or "",
                    "book_page_end": r["book_end"] or "",
                    "text_anchor": r["text_anchor"] or "",
                    "definition_text": r["definition_text"] or "",
                    "original_text": r["original_text"] or "",
                    "description": r["description"] or "",
                    "cdss_dict_id": r["cdss_dict_id"] or "",
                    "clinical_review_status": r["review_status"] or "",
                    "execution_status": r["execution_status"] or "",
                    "inference_status": r["inference_status"] or "",
                    "applicable_stage": r["applicable_stage"] or "",
                    "assessment_method": r["assessment_method"] or "",
                    "care_context": r["care_context"] or "",
                    "evidence_count": r["evidence_count"] or 0,
                }

                # Definition 二跳 — DefinitionComponent
                if dim == "Definition" and r["ncode"]:
                    item["sub_component"] = []
                    try:
                        sub_comps = sess.run("""
                            MATCH (def:KGNode {code: $def_code})-[:has_definition_component]->(c)
                            RETURN DISTINCT c.code as code, c.name as name, c.preferred_name as pref,
                                   c.display_name as dn, c.name_en as name_en,
                                   c.description as content, c.original_text as original_text
                            ORDER BY c.name LIMIT 20
                        """, def_code=r["ncode"])
                        for sc in sub_comps:
                            n = clean_name_from_row(sc, 'pref', 'name', 'code')
                            item["sub_component"].append({
                                "name": n, "code": sc["code"],
                                "name_en": sc["name_en"] or "",
                                "content": sc["content"] or "",
                                "original_text": sc["original_text"] or "",
                            })
                    except Exception:
                        pass

                # TreatmentPlan 二跳
                if dim == "TreatmentPlan" and r["ncode"]:
                    item["sub_drug"] = []
                    item["sub_procedure"] = []
                    item["sub_treatment_item"] = []
                    item["sub_evidence"] = []
                    try:
                        sub_meds = sess.run("""
                            MATCH (tp:KGNode {code: $tp_code})-[:includes_drug]->(m)
                            RETURN DISTINCT m.code as code, m.name as name, m.preferred_name as pref
                            ORDER BY m.name LIMIT 15
                        """, tp_code=r["ncode"])
                        for sm in sub_meds:
                            n = clean_name_from_row(sm, 'pref', 'name', 'code')
                            item["sub_drug"].append({"name": n, "code": sm["code"]})

                        sub_tis = sess.run("""
                            MATCH (tp:KGNode {code: $tp_code})-[:includes_treatment_item]->(t)
                            RETURN DISTINCT t.code as code, t.name as name, t.preferred_name as pref
                            ORDER BY t.name LIMIT 15
                        """, tp_code=r["ncode"])
                        for st in sub_tis:
                            n = clean_name_from_row(st, 'pref', 'name', 'code')
                            item["sub_treatment_item"].append({"name": n, "code": st["code"]})

                        sub_procs = sess.run("""
                            MATCH (tp:KGNode {code: $tp_code})-[:includes_procedure]->(p)
                            RETURN DISTINCT p.code as code, p.name as name, p.preferred_name as pref
                            ORDER BY p.name LIMIT 15
                        """, tp_code=r["ncode"])
                        for sp in sub_procs:
                            n = clean_name_from_row(sp, 'pref', 'name', 'code')
                            proc_item = {"name": n, "code": sp["code"], "std_procedures": []}
                            # 查询 StandardProcedure
                            try:
                                sp_rs = sess.run("""
                                    MATCH (p:Procedure {code: $proc_code})
                                    WHERE p.standard_code IS NOT NULL AND p.standard_code <> ''
                                    RETURN DISTINCT p.code as code, p.name as name,
                                           p.standard_code as standard_code, p.coding_system as coding_system
                                    LIMIT 5
                                """, proc_code=sp["code"])
                                for sp_row in sp_rs:
                                    proc_item["std_procedures"].append({
                                        "name": sp_row["name"] or "",
                                        "standard_code": sp_row["standard_code"] or "",
                                        "coding_system": sp_row["coding_system"] or "",
                                    })
                            except Exception:
                                pass
                            item["sub_procedure"].append(proc_item)

                        sub_evids = sess.run("""
                            MATCH (tp:KGNode {code: $tp_code})-[:supported_by_evidence]->(e)
                            RETURN DISTINCT e.code as code, e.name as name, e.preferred_name as pref
                            ORDER BY e.name LIMIT 10
                        """, tp_code=r["ncode"])
                        for se in sub_evids:
                            n = clean_name_from_row(se, 'pref', 'name', 'code')
                            item["sub_evidence"].append({"name": n, "code": se["code"]})
                    except Exception:
                        pass

                # Drug 二跳
                if dim == "Drug" and r["ncode"]:
                    item["sub_drug"] = []
                    try:
                        sub_meds = sess.run("""
                            MATCH (m:KGNode {code: $med_code})-[:has_specific_drug]->(s)
                            RETURN DISTINCT s.code as code, s.name as name, s.preferred_name as pref
                            ORDER BY s.name LIMIT 15
                        """, med_code=r["ncode"])
                        for sm in sub_meds:
                            n = clean_name_from_row(sm, 'pref', 'name', 'code')
                            item["sub_drug"].append({"name": n, "code": sm["code"]})
                    except Exception:
                        pass

                # Procedure 二跳 — CDSS 手术字典编码（V4.1：standard_code 在 Procedure 节点自身）
                if dim == "Procedure" and r["ncode"]:
                    item["std_procedures"] = []
                    try:
                        sp_rs = sess.run("""
                            MATCH (p:Procedure {code: $proc_code})
                            WHERE p.standard_code IS NOT NULL AND p.standard_code <> ''
                            RETURN DISTINCT p.code as code, p.name as name,
                                   p.standard_code as standard_code, p.coding_system as coding_system
                            LIMIT 10
                        """, proc_code=r["ncode"])
                        for sp in sp_rs:
                            item["std_procedures"].append({
                                "name": sp["name"] or "",
                                "code": sp["code"] or "",
                                "standard_code": sp["standard_code"] or "",
                                "coding_system": sp["coding_system"] or "",
                            })
                    except Exception:
                        pass

                # 护理维度二跳（Schema V4.0 护理批次：护理计划四件套 / 评估条目 / 措施 / 结局 / 量表）
                if dim in ("NursingCarePlan", "NursingAssessment", "NursingDiagnosis") and r["ncode"]:
                    if dim == "NursingCarePlan":
                        sub_specs = [
                            ("护理诊断", "plan_has_nursing_diagnosis"),
                            ("护理措施", "includes_nursing_intervention"),
                            ("护理结局", "plan_targets_outcome"),
                            ("护理评估", "plan_uses_assessment"),
                        ]
                    elif dim == "NursingAssessment":
                        sub_specs = [
                            ("评估条目", "has_nursing_assessment_item"),
                            ("记录条目", "records_nursing_item"),
                            ("评估量表", "uses_assessment_scale"),
                        ]
                    else:
                        sub_specs = [
                            ("护理措施", "has_nursing_intervention"),
                            ("护理结局", "targets_nursing_outcome"),
                        ]
                    item["nursing_sub"] = []
                    for sub_label, sub_rel in sub_specs:
                        try:
                            sub_rows = sess.run(f"""
                                MATCH (n:KGNode {{code: $ncode}})-[:{sub_rel}]->(m:KGNode)
                                WHERE (m.status IS NULL OR m.status <> 'deprecated')
                                RETURN DISTINCT m.code AS code, m.name AS name, m.preferred_name AS pref,
                                       coalesce(m.intervention_text, m.outcome_definition, m.assessment_method,
                                                m.observation_method, m.rule_text, '') AS text
                                ORDER BY name LIMIT 20
                            """, ncode=r["ncode"])
                            sub_items = []
                            for sr in sub_rows:
                                sub_items.append({
                                    "name": clean_name_from_row(sr, 'pref', 'name', 'code'),
                                    "code": sr["code"],
                                    "text": sr["text"] or "",
                                })
                            if sub_items:
                                item["nursing_sub"].append({"label": sub_label, "rel": sub_rel, "items": sub_items})
                        except Exception:
                            pass

                # RiskStratification 二跳（风险分层结构：评分参数 / 风险层级 / 分层策略 / 相关推荐）
                if dim == "RiskStratification" and r["ncode"]:
                    item["risk_sub"] = {}
                    # 评分参数（评估表单组件，has_risk_factor）
                    try:
                        rf_rows = sess.run("""
                            MATCH (rs:KGNode {code: $rcode})-[:has_risk_factor]->(rf:KGNode)
                            WHERE (rf.status IS NULL OR rf.status <> 'deprecated')
                            RETURN DISTINCT rf.code AS code, rf.name AS name, rf.preferred_name AS pref
                            ORDER BY name LIMIT 20
                        """, rcode=r["ncode"])
                        item["risk_sub"]["factors"] = [
                            {"name": clean_name_from_row(x, 'pref', 'name', 'code'), "code": x["code"]}
                            for x in rf_rows
                        ]
                    except Exception:
                        item["risk_sub"]["factors"] = []
                    # 风险层级节点（同名前缀层级节点，如 GRACE评分高危（>140分））
                    try:
                        lv_rows = sess.run("""
                            MATCH (lv:RiskStratification)
                            WHERE lv.name STARTS WITH $bname AND lv.name <> $bname
                              AND lv.name CONTAINS '危' AND (lv.name CONTAINS '（' OR lv.name CONTAINS '(')
                              AND (lv.status IS NULL OR lv.status <> 'deprecated')
                            RETURN DISTINCT lv.code AS code, lv.name AS name, lv.original_text AS ot
                            LIMIT 10
                        """, bname=name)
                        _sev = {'极高危': 0, '高危': 1, '中高危': 2, '中危': 3, '中低危': 4, '低危': 5}
                        def _sev_key(nm):
                            for _k, _v in _sev.items():
                                if _k in nm:
                                    return _v
                            return 9
                        lvs = [{"name": x["name"], "code": x["code"], "text": (x["ot"] or "")[:120]} for x in lv_rows]
                        lvs.sort(key=lambda x: _sev_key(x["name"]))
                        item["risk_sub"]["levels"] = lvs
                    except Exception:
                        item["risk_sub"]["levels"] = []
                    # 相关推荐（RecommendationStatement -recommends_action-> 本评分，V4.1 统一推荐动作关系）
                    try:
                        rec_rows = sess.run("""
                            MATCH (rec:RecommendationStatement)-[rel]->(rs:KGNode {code: $rcode})
                            WHERE type(rel) = 'recommends_action'
                              AND (rec.status IS NULL OR rec.status <> 'deprecated')
                            WITH rec, collect(DISTINCT type(rel)) AS rels
                            RETURN rec.code AS code, rec.name AS name,
                                   rec.statement_summary AS summary, rec.action_name AS action,
                                   rec.pathway_name AS pathway, rec.recommendation_class AS cls, rels
                            ORDER BY name LIMIT 10
                        """, rcode=r["ncode"])
                        item["risk_sub"]["recommendations"] = [
                            {
                                "name": x["name"], "code": x["code"],
                                "summary": x["summary"] or "", "action": x["action"] or "",
                                "pathway": x["pathway"] or "", "cls": x["cls"] or "",
                                "rels": [t for t in x["rels"] if t],
                            } for x in rec_rows
                        ]
                    except Exception:
                        item["risk_sub"]["recommendations"] = []
                    # 分层策略证据摘录（疾病→评分关系上的 evidence_text，含 分数区间→处置策略 表）
                    try:
                        item["risk_sub"]["strategy_texts"] = []
                        st_seen = set()
                        st_rows = sess.run("""
                            MATCH (:Disease)-[rel:has_risk_stratification]->(rs:KGNode {code: $rcode})
                            WHERE rel.evidence_text IS NOT NULL AND rel.evidence_text CONTAINS '危'
                            RETURN DISTINCT rel.evidence_text AS et
                            LIMIT 8
                        """, rcode=r["ncode"])
                        for x in st_rows:
                            t = (x["et"] or "").strip()
                            if t and t not in st_seen:
                                st_seen.add(t)
                                item["risk_sub"]["strategy_texts"].append(t[:240])
                    except Exception:
                        item["risk_sub"]["strategy_texts"] = []
                    if not any(item["risk_sub"].values()):
                        del item["risk_sub"]

                # DiagnosisCriteria 二跳 - 增强版：含 rule_logic + actions + evidence
                if dim == "DiagnosisCriteria" and r["ncode"]:
                    item["sub_component"] = []
                    item["sub_evidence"] = []
                    try:
                        # 查询诊断标准自身的证据
                        dc_ev_rs = sess.run("""
                            MATCH (dc:KGNode {code: $dc_code})-[:supported_by_evidence]->(e)
                            RETURN DISTINCT e.code as code, e.name as name, e.preferred_name as pref
                            ORDER BY e.name LIMIT 10
                        """, dc_code=r["ncode"])
                        for ev in dc_ev_rs:
                            n = clean_name_from_row(ev, 'pref', 'name', 'code')
                            item["sub_evidence"].append({"name": n, "code": ev["code"]})

                        sub_comps = sess.run("""
                            MATCH (dc:KGNode {code: $dc_code})-[:has_diagnostic_component]->(c)
                            RETURN DISTINCT c.code as code, c.name as name, c.preferred_name as pref,
                                   c.display_name as dn, c.name_en as name_en, c.rule_logic as rule_logic
                            ORDER BY c.name LIMIT 20
                        """, dc_code=r["ncode"])
                        for sc in sub_comps:
                            n = clean_name_from_row(sc, 'pref', 'name', 'code')
                            comp = {
                                "name": n,
                                "code": sc["code"],
                                "name_en": sc["name_en"] or "",
                                "rule_logic": sc["rule_logic"] or "",
                                "actions": [],
                                "evidence": [],
                            }
                            # 查询 recommends_action
                            try:
                                act_rs = sess.run("""
                                    MATCH (c:KGNode {code: $c_code})-[:recommends_action]->(a)
                                    RETURN DISTINCT a.code as code, a.name as name, a.preferred_name as pref,
                                           a.display_name as dn
                                    ORDER BY a.name LIMIT 30
                                """, c_code=sc["code"])
                                for act in act_rs:
                                    comp["actions"].append({
                                        "name": clean_name_from_row(act, 'pref', 'name', 'code'),
                                        "code": act["code"],
                                    })
                            except Exception:
                                pass
                            # 查询 supported_by_evidence
                            try:
                                ev_rs = sess.run("""
                                    MATCH (c:KGNode {code: $c_code})-[:supported_by_evidence]->(e)
                                    RETURN DISTINCT e.code as code, e.name as name, e.preferred_name as pref,
                                           e.display_name as dn, e.source_file as source_file, e.source_page as source_page,
                                           e.recommendation_class as rec_class, e.evidence_level as ev_level
                                    ORDER BY e.name LIMIT 30
                                """, c_code=sc["code"])
                                for ev in ev_rs:
                                    comp["evidence"].append({
                                        "name": clean_name_from_row(ev, 'pref', 'name', 'code'),
                                        "code": ev["code"],
                                        "source_file": ev["source_file"] or "",
                                        "source_page": ev["source_page"] or "",
                                        "recommendation_class": ev["rec_class"] or "",
                                        "evidence_level": ev["ev_level"] or "",
                                    })
                            except Exception:
                                pass
                            item["sub_component"].append(comp)
                    except Exception:
                        pass

                # DifferentialDiagnosis 二跳
                if dim == "DifferentialDiagnosis" and r["ncode"]:
                    item["differential_points"] = []
                    item["exclusion_exams"] = []
                    item["exclusion_labs"] = []
                    item["blocked_actions"] = []
                    item["differential_rules"] = []
                    item["related_exams"] = []
                    item["related_labs"] = []
                    dd_code = r["ncode"]
                    seen_ex = {}
                    seen_lb = {}
                    # 查询1：鉴别规则 + 规则下的排除检查/检验
                    try:
                        rule_rs = sess.run("""
                            MATCH (dd:KGNode {code: $dd_code})-[:has_differential_rule]->(cr:KGNode)
                            OPTIONAL MATCH (cr)-[:requires_exclusion_exam]->(rex:KGNode)
                            OPTIONAL MATCH (cr)-[:requires_exclusion_lab]->(rlb:KGNode)
                            WITH cr, collect(DISTINCT rex) as rex_list, collect(DISTINCT rlb) as rlb_list
                            RETURN cr.code AS cr_code, cr.name AS cr_name, cr.preferred_name AS cr_pref,
                                   cr.display_name AS cr_dn, cr.rule_logic AS cr_logic,
                                   rex_list, rlb_list
                            ORDER BY cr.name LIMIT 20
                        """, dd_code=dd_code)
                        for rr in rule_rs:
                            rname = clean_name_from_row(rr, "cr_pref", "cr_name", "cr_code")
                            item["differential_rules"].append({
                                "name": rname,
                                "rule_logic": rr["cr_logic"] or "",
                            })
                            for rex in (rr["rex_list"] or []):
                                nm = clean_name_from_row(rex, "preferred_name", "name", "code")
                                if nm and nm not in seen_ex:
                                    seen_ex[nm] = {"name": nm, "code": rex.get("code") or "", "purpose": "排除"}
                                    item["exclusion_exams"].append({"name": nm, "code": rex.get("code") or ""})
                            for rlb in (rr["rlb_list"] or []):
                                nm = clean_name_from_row(rlb, "preferred_name", "name", "code")
                                if nm and nm not in seen_lb:
                                    seen_lb[nm] = {"name": nm, "code": rlb.get("code") or "", "purpose": "排除"}
                                    item["exclusion_labs"].append({"name": nm, "code": rlb.get("code") or ""})
                    except Exception:
                        pass
                    # 查询2：DD直连的所有检查/检验实体
                    try:
                        dd_exam_rs = sess.run("""
                            MATCH (dd:KGNode {code: $dd_code})-[r]->(e:KGNode)
                            WHERE e.entityType IN ["ExamItem", "ExamObservation"]
                            RETURN DISTINCT e.code as code, e.name as name, e.preferred_name as pref,
                                   e.display_name as dn, type(r) as rel_type
                            ORDER BY e.name LIMIT 50
                        """, dd_code=dd_code)
                        for ex in dd_exam_rs:
                            nm = clean_name_from_row(ex, "pref", "name", "code")
                            if not nm or nm in seen_ex:
                                continue
                            purpose = "排除" if "exclusion" in (ex.get("rel_type") or "").lower() else "辅助鉴别"
                            seen_ex[nm] = {"name": nm, "code": ex.get("code") or "", "purpose": purpose}
                            if purpose == "排除":
                                item["exclusion_exams"].append({"name": nm, "code": ex.get("code") or ""})
                    except Exception:
                        pass
                    try:
                        dd_lab_rs = sess.run("""
                            MATCH (dd:KGNode {code: $dd_code})-[r]->(l:KGNode)
                            WHERE l.entityType IN ["LabItem", "LabSubitem"]
                            RETURN DISTINCT l.code as code, l.name as name, l.preferred_name as pref,
                                   l.display_name as dn, type(r) as rel_type
                            ORDER BY l.name LIMIT 50
                        """, dd_code=dd_code)
                        for lb in dd_lab_rs:
                            nm = clean_name_from_row(lb, "pref", "name", "code")
                            if not nm or nm in seen_lb:
                                continue
                            purpose = "排除" if "exclusion" in (lb.get("rel_type") or "").lower() else "辅助鉴别"
                            seen_lb[nm] = {"name": nm, "code": lb.get("code") or "", "purpose": purpose}
                            if purpose == "排除":
                                item["exclusion_labs"].append({"name": nm, "code": lb.get("code") or ""})
                    except Exception:
                        pass
                    item["related_exams"] = list(seen_ex.values())
                    item["related_labs"] = list(seen_lb.values())
                    # 查询3：阻断动作
                    try:
                        for blk_rel in ["may_block_action", "blocks_action"]:
                            blk_rs = sess.run("""
                                MATCH (dd:KGNode {code: $dd_code})-[:%s]->(b)
                                RETURN DISTINCT b.code as code, b.name as name, b.preferred_name as pref,
                                       b.display_name as dn
                                ORDER BY b.name LIMIT 30
                            """ % blk_rel, dd_code=dd_code)
                            for blk in blk_rs:
                                item["blocked_actions"].append({
                                    "name": clean_name_from_row(blk, "pref", "name", "code"),
                                    "code": blk["code"],
                                })
                    except Exception:
                        pass
                    # 查询4：鉴别要点（与规则重名的剔除）
                    try:
                        dp_rs = sess.run("""
                            MATCH (dd:KGNode {code: $dd_code})-[:has_differential_point]->(p)
                            RETURN DISTINCT p.code as code, p.name as name, p.preferred_name as pref,
                                   p.display_name as dn
                            ORDER BY p.name LIMIT 30
                        """, dd_code=dd_code)
                        rule_names = {x["name"] for x in item["differential_rules"]}
                        for dp in dp_rs:
                            nm = clean_name_from_row(dp, "pref", "name", "code")
                            if nm not in rule_names:
                                item["differential_points"].append({
                                    "name": nm,
                                    "code": dp["code"],
                                })
                    except Exception:
                        pass
                items.append(item)
            dimensions[dim] = items

        # V2.0 第二层：CDSS标准主数据层 — StandardDiagnosis
        std_dx_items = []
        try:
            std_dx_rs = sess.run("""
                MATCH (d:Disease {code: $code})-[r:has_standard_diagnosis]->(s:StandardDiagnosis)
                WHERE s.valid_flag = 1 OR s.valid_flag = '1'
                RETURN s.code AS code, s.name AS name, s.standard_code AS standard_code,
                       s.coding_system AS coding_system, s.coding_system_version AS coding_ver,
                       s.cdss_dict_id AS cdss_uuid, s.valid_flag AS valid_flag,
                       s.source_table AS source_table, s.source_version AS source_ver,
                       r.mapping_type AS mapping_type, r.is_emr_writable AS is_emr_writable
                ORDER BY s.standard_code
            """, code=code)
            for sr in std_dx_rs:
                std_dx_items.append({
                    "name": sr["name"] or "",
                    "code": sr["code"] or "",
                    "standard_code": sr["standard_code"] or "",
                    "coding_system": sr["coding_system"] or "",
                    "coding_system_version": sr["coding_ver"] or "",
                    "cdss_dict_id": sr["cdss_uuid"] or "",
                    "valid_flag": sr["valid_flag"] or "",
                    "source_table": sr["source_table"] or "",
                    "source_version": sr["source_ver"] or "",
                    "mapping_type": sr["mapping_type"] or "",
                    "is_emr_writable": sr["is_emr_writable"],
                })
        except Exception:
            pass
        dimensions["StandardDiagnosis"] = std_dx_items

        # 二跳/三跳维度：ThresholdRule、ExamObservation、LabSubitem
        for dim, cfg in TWO_HOP_DIMS.items():
            items = []
            seen = set()
            for chain in cfg["rel_chain"]:
                try:
                    if 'hop3_rel' in chain:
                        # Schema V2.x 三跳: Disease -> x -> y -> n
                        results = sess.run(f"""
                            MATCH (d:Disease {{code: $code}})
                                  -[:{chain['rel_to']}]->(x:KGNode)
                                  -[:{chain['hop2_rel']}]->(y:KGNode)
                                  -[:{chain['hop3_rel']}]->(n)
                            WHERE (n.status IS NULL OR n.status <> 'deprecated')
                            RETURN DISTINCT n.code as ncode, n.name as name, n.preferred_name as pref,
                                   n.display_name as dn,
                                   y.code as parent_code, y.name as parent_name
                            ORDER BY n.name LIMIT 200
                        """, code=code)
                    else:
                        # 兼容原有二跳
                        results = sess.run(f"""
                            MATCH (d:Disease {{code: $code}})-[:{chain['rel_to']}]->(x:KGNode)-[:{chain['hop2_rel']}]->(n)
                            WHERE (n.status IS NULL OR n.status <> 'deprecated')
                            RETURN DISTINCT n.code as ncode, n.name as name, n.preferred_name as pref,
                                   n.display_name as dn
                            ORDER BY n.name LIMIT 200
                        """, code=code)
                    for r in results:
                        name = clean_name_from_row(r, 'pref', 'name', 'ncode')
                        if name in seen:
                            continue
                        seen.add(name)
                        item = {"name": name, "code": r["ncode"], "name_en": "", "aliases": []}
                        if r.get("parent_code"):
                            item["parent_code"] = r["parent_code"]
                            item["parent_name"] = r.get("parent_name") or ""
                        items.append(item)
                except Exception:
                    pass
            dimensions[dim] = items

        # ClinicalRule 维度（临床规则）
        clinical_rules = []
        seen_rule_codes = set()
        try:
            # 路径1: 诊断标准 -> 诊断组件 -> ClinicalRule
            cr_rs1 = sess.run("""
                MATCH (d:Disease {code: $code})
                      -[:has_diagnostic_criteria]->(dx:KGNode)
                      -[:has_diagnostic_component]->(r:KGNode {entityType:'ClinicalRule'})
                WHERE (r.status IS NULL OR r.status <> 'deprecated')
                RETURN DISTINCT r.code as code, r.name as name, r.preferred_name as pref,
                       r.display_name as dn, r.description as desc,
                       r.rule_logic as logic, r.trigger_condition as trigger,
                       r.output_content as output, r.usage_boundary as boundary,
                       r.trigger_phase as phase, r.read_fields as fields,
                       r.category as category, r.stage as stage
                ORDER BY r.name LIMIT 100
            """, code=code)
            for r in cr_rs1:
                if r["code"] not in seen_rule_codes:
                    seen_rule_codes.add(r["code"])
                    clinical_rules.append({
                        "name": clean_name_from_row(r, 'pref', 'name', 'code'),
                        "code": r["code"],
                        "description": r["desc"] or "",
                        "rule_logic": r["logic"] or "",
                        "trigger_condition": r["trigger"] or "",
                        "output_content": r["output"] or "",
                        "usage_boundary": r["boundary"] or "",
                        "trigger_phase": r["phase"] or "",
                        "read_fields": r["fields"] or "",
                        "category": r["category"] or "",
                        "stage": r["stage"] or "",
                        "source": "diagnostic_criteria",
                    })
            # 路径2: 专科路径 -> 阶段 -> ClinicalRule（Schema V4.1：has_specialty_care_pathway/includes_pathway_stage/has_clinical_rule）
            cr_rs2 = sess.run("""
                MATCH (d:Disease {code: $code})
                      -[:has_specialty_care_pathway]->(p:KGNode)
                      -[:includes_pathway_stage]->(s:KGNode)
                      -[:has_clinical_rule]->(r:KGNode {entityType:'ClinicalRule'})
                WHERE (r.status IS NULL OR r.status <> 'deprecated')
                RETURN DISTINCT r.code as code, r.name as name, r.preferred_name as pref,
                       r.display_name as dn, r.description as desc,
                       r.rule_logic as logic, r.trigger_condition as trigger,
                       r.output_content as output, r.usage_boundary as boundary,
                       r.trigger_phase as phase, r.read_fields as fields,
                       r.category as category, r.stage as stage,
                       s.name as stage_name, p.name as pathway_name
                ORDER BY r.name LIMIT 100
            """, code=code)
            for r in cr_rs2:
                if r["code"] not in seen_rule_codes:
                    seen_rule_codes.add(r["code"])
                    clinical_rules.append({
                        "name": clean_name_from_row(r, 'pref', 'name', 'code'),
                        "code": r["code"],
                        "description": r["desc"] or "",
                        "rule_logic": r["logic"] or "",
                        "trigger_condition": r["trigger"] or "",
                        "output_content": r["output"] or "",
                        "usage_boundary": r["boundary"] or "",
                        "trigger_phase": r["phase"] or "",
                        "read_fields": r["fields"] or "",
                        "category": r["category"] or "",
                        "stage": r["stage"] or "",
                        "source": "clinical_pathway",
                        "stage_name": r["stage_name"] or "",
                        "pathway_name": r["pathway_name"] or "",
                    })
            # 路径3: Disease 直连 ClinicalRule（Schema V4.1 has_clinical_rule，主链路）
            cr_rs3 = sess.run("""
                MATCH (d:Disease {code: $code})-[:has_clinical_rule]->(r:KGNode {entityType:'ClinicalRule'})
                WHERE (r.status IS NULL OR r.status <> 'deprecated')
                RETURN DISTINCT r.code as code, r.name as name, r.preferred_name as pref,
                       r.display_name as dn, r.description as desc,
                       r.rule_logic as logic, r.trigger_condition as trigger,
                       r.output_content as output, r.usage_boundary as boundary,
                       r.trigger_phase as phase, r.read_fields as fields,
                       r.category as category, r.stage as stage
                ORDER BY r.name LIMIT 100
            """, code=code)
            for r in cr_rs3:
                if r["code"] not in seen_rule_codes:
                    seen_rule_codes.add(r["code"])
                    clinical_rules.append({
                        "name": clean_name_from_row(r, 'pref', 'name', 'code'),
                        "code": r["code"],
                        "description": r["desc"] or "",
                        "rule_logic": r["logic"] or "",
                        "trigger_condition": r["trigger"] or "",
                        "output_content": r["output"] or "",
                        "usage_boundary": r["boundary"] or "",
                        "trigger_phase": r["phase"] or "",
                        "read_fields": r["fields"] or "",
                        "category": r["category"] or "",
                        "stage": r["stage"] or "",
                        "source": "disease_rule",
                    })
        except Exception:
            pass
        dimensions["ClinicalRule"] = clinical_rules

        # 关系统计
        rel_stats = sess.run("""
            MATCH (d:Disease {code: $code})-[r]->(n)
            WHERE NOT type(r) IN $excl
            RETURN type(r) as rel, n.name as name, labels(n) as lbl
            ORDER BY type(r)
        """, code=code, excl=EXCLUDE_REL)
        relations_summary = [dict(r) for r in rel_stats]

        # 证据总数（不受 LIMIT 30 限制）
        ev_cnt = sess.run("""
            MATCH (d:Disease {code: $code})-[:supported_by_evidence]->(e:Evidence)
            RETURN count(e) as cnt
        """, code=code).single()["cnt"]

        # ClinicalPathway 维度
        pathways = []
        try:
            pathway_results = sess.run("""
                MATCH (d:Disease {code: $code})-[:has_specialty_care_pathway]->(p:KGNode {entityType:'SpecialtyCarePathway'})
                OPTIONAL MATCH (p)-[:includes_pathway_stage]->(s:KGNode {entityType:'PathwayStage'})
                RETURN p.code AS code, p.name AS name,
                       collect(DISTINCT {
                           code: s.code, name: s.name,
                           stage_order: s.stage_order, stage_goal: s.stage_goal,
                           trigger_condition: s.trigger_condition, exit_condition: s.exit_condition
                       }) AS stages
                ORDER BY p.name LIMIT 10
            """, code=code)
            for pr in pathway_results:
                pw = {
                    "code": pr["code"],
                    "name": pr["name"],
                    "stages": [],
                }
                for s in pr["stages"]:
                    if not s["code"]:
                        continue
                    stage = {
                        "code": s["code"],
                        "name": s["name"],
                        "stage_order": s.get("stage_order"),
                        "stage_goal": s.get("stage_goal") or "",
                        "rules": [],
                        "recommended_actions": [],
                        "blocked_actions": [],
                        "evidence": [],
                    }
                    # has_clinical_rule（V4.1：阶段→规则）
                    try:
                        rule_rs = sess.run("""
                            MATCH (s:KGNode {code: $s_code})-[:has_clinical_rule]->(r)
                            RETURN DISTINCT r.code as code, r.name as name, r.preferred_name as pref,
                                   r.display_name as dn
                            ORDER BY r.name LIMIT 30
                        """, s_code=s["code"])
                        for rule in rule_rs:
                            stage["rules"].append({
                                "name": clean_name_from_row(rule, 'pref', 'name', 'code'),
                                "code": rule["code"],
                            })
                    except Exception:
                        pass
                    # has_recommended_action / recommends_action
                    try:
                        for act_rel in ["has_recommended_action", "recommends_action"]:
                            act_rs = sess.run("""
                                MATCH (s:KGNode {code: $s_code})-[:%s]->(a)
                                RETURN DISTINCT a.code as code, a.name as name, a.preferred_name as pref,
                                       a.display_name as dn
                                ORDER BY a.name LIMIT 30
                            """ % act_rel, s_code=s["code"])
                            for act in act_rs:
                                stage["recommended_actions"].append({
                                    "name": clean_name_from_row(act, 'pref', 'name', 'code'),
                                    "code": act["code"],
                                })
                    except Exception:
                        pass
                    # blocks_action
                    try:
                        blk_rs = sess.run("""
                            MATCH (s:KGNode {code: $s_code})-[:blocks_action]->(b)
                            RETURN DISTINCT b.code as code, b.name as name, b.preferred_name as pref,
                                   b.display_name as dn
                            ORDER BY b.name LIMIT 30
                        """, s_code=s["code"])
                        for blk in blk_rs:
                            stage["blocked_actions"].append({
                                "name": clean_name_from_row(blk, 'pref', 'name', 'code'),
                                "code": blk["code"],
                            })
                    except Exception:
                        pass
                    # supported_by_evidence
                    try:
                        ev_rs = sess.run("""
                            MATCH (s:KGNode {code: $s_code})-[:supported_by_evidence]->(e)
                            RETURN DISTINCT e.code as code, e.name as name, e.preferred_name as pref,
                                   e.display_name as dn, e.source_file as source_file, e.source_page as source_page,
                                   e.recommendation_class as rec_class, e.evidence_level as ev_level
                            ORDER BY e.name LIMIT 30
                        """, s_code=s["code"])
                        for ev in ev_rs:
                            stage["evidence"].append({
                                "name": clean_name_from_row(ev, 'pref', 'name', 'code'),
                                "code": ev["code"],
                                "source_file": ev["source_file"] or "",
                                "source_page": ev["source_page"] or "",
                                "recommendation_class": ev["rec_class"] or "",
                                "evidence_level": ev["ev_level"] or "",
                            })
                    except Exception:
                        pass
                    pw["stages"].append(stage)
                pathways.append(pw)
        except Exception:
            pass

        # ===== 专科CDSS诊疗链路：首诊辅助检查/检验（Disease->has_exam_plan->ExamPlan->includes_exam_item/includes_lab_item）=====
        # 关系级元数据：clinical_stage / purpose / service_target_name / priority_level
        exam_plans = []
        try:
            ep_rs = sess.run("""
                MATCH (d:Disease {code: $code})-[:has_exam_plan]->(ep:KGNode)
                OPTIONAL MATCH (ep)-[r:includes_exam_item|includes_lab_item]->(n:KGNode)
                WHERE n IS NULL OR n.status IS NULL OR n.status <> 'deprecated'
                RETURN ep.code AS ep_code, ep.name AS ep_name,
                       ep.preferred_name AS ep_pref, ep.display_name AS ep_dn,
                       n.code AS n_code, n.name AS n_name,
                       n.preferred_name AS n_pref, n.display_name AS n_dn,
                       type(r) AS rel_type,
                       r.clinical_stage AS clinical_stage, r.purpose AS purpose,
                       r.service_target_name AS service_target_name,
                       r.priority_level AS priority_level,
                       r.evidence_id AS evidence_id, r.source_name AS source_name,
                       r.source_page AS source_page
                ORDER BY ep.name, n.name
            """, code=code)
            plan_map = {}
            plan_order = []
            for row in ep_rs:
                ep_code = row["ep_code"]
                if ep_code not in plan_map:
                    plan_map[ep_code] = {
                        "code": ep_code,
                        "name": clean_name_from_row(row, 'ep_pref', 'ep_name', 'ep_code'),
                        "exam_items": [],
                        "lab_items": [],
                    }
                    plan_order.append(ep_code)
                if not row["n_code"]:
                    continue
                entry = {
                    "name": clean_name_from_row(row, 'n_pref', 'n_name', 'n_code'),
                    "code": row["n_code"],
                    "clinical_stage": row["clinical_stage"] or "",
                    "purpose": row["purpose"] or "",
                    "service_target_name": row["service_target_name"] or "",
                    "priority_level": row["priority_level"] or "",
                    "evidence_id": row["evidence_id"] or "",
                    "source_name": row["source_name"] or "",
                    "source_page": row["source_page"] or "",
                }
                if row["rel_type"] == "includes_lab_item":
                    plan_map[ep_code]["lab_items"].append(entry)
                else:
                    plan_map[ep_code]["exam_items"].append(entry)
            exam_plans = [plan_map[c] for c in plan_order]
        except Exception:
            pass

        # ===== 专科CDSS诊疗链路：鉴别诊断（DD->has_differential_rule->ClinicalRule->requires_exclusion_exam/lab）=====
        differentials = []
        try:
            dd_rs = sess.run("""
                MATCH (d:Disease {code: $code})-[:has_differential_diagnosis]->(dd:KGNode)
                OPTIONAL MATCH (dd)-[:has_differential_rule]->(cr:KGNode)
                OPTIONAL MATCH (cr)-[:requires_exclusion_exam]->(ex:KGNode)
                OPTIONAL MATCH (cr)-[:requires_exclusion_lab]->(lb:KGNode)
                RETURN dd.code AS dd_code, dd.name AS dd_name,
                       dd.preferred_name AS dd_pref, dd.display_name AS dd_dn,
                       dd.description AS dd_desc,
                       cr.code AS cr_code, cr.name AS cr_name,
                       cr.preferred_name AS cr_pref, cr.display_name AS cr_dn,
                       cr.rule_logic AS cr_logic, cr.description AS cr_desc,
                       cr.output_content AS cr_output, cr.usage_boundary AS cr_boundary,
                       collect(DISTINCT ex.name) AS excl_exam_names,
                       collect(DISTINCT lb.name) AS excl_lab_names
                ORDER BY dd.name, cr.name
            """, code=code)
            dd_map = {}
            dd_order = []
            rule_map = {}
            for row in dd_rs:
                dd_code = row["dd_code"]
                if dd_code not in dd_map:
                    dd_map[dd_code] = {
                        "code": dd_code,
                        "name": clean_name_from_row(row, 'dd_pref', 'dd_name', 'dd_code'),
                        "description": row["dd_desc"] or "",
                        "rules": [],
                    }
                    dd_order.append(dd_code)
                if not row["cr_code"]:
                    continue
                rk = dd_code + '|' + row["cr_code"]
                if rk not in rule_map:
                    rule = {
                        "code": row["cr_code"],
                        "name": clean_name_from_row(row, 'cr_pref', 'cr_name', 'cr_code'),
                        "rule_logic": row["cr_logic"] or row["cr_desc"] or "",
                        "output_content": row["cr_output"] or "",
                        "usage_boundary": row["cr_boundary"] or "",
                        "exclusion_exams": [],
                        "exclusion_labs": [],
                    }
                    rule_map[rk] = rule
                    dd_map[dd_code]["rules"].append(rule)
                rule = rule_map[rk]
                for n in (row["excl_exam_names"] or []):
                    if n and n not in rule["exclusion_exams"]:
                        rule["exclusion_exams"].append(n)
                for n in (row["excl_lab_names"] or []):
                    if n and n not in rule["exclusion_labs"]:
                        rule["exclusion_labs"].append(n)
            for dd_code in dd_order:
                dd = dd_map[dd_code]
                # DD 直连的检查/检验实体（不限于排除用途）
                dd["exams"] = []
                dd["labs"] = []
                try:
                    dd_exam_rs = sess.run("""
                        MATCH (dd:KGNode {code: $dd_code})-[r]->(e:KGNode)
                        WHERE e.entityType IN ['ExamItem', 'ExamObservation']
                        OR type(r) IN ['requires_exclusion_exam', 'has_exam_item_for_differential']
                        RETURN DISTINCT e.code as code, e.name as name, e.preferred_name as pref,
                               e.display_name as dn, type(r) as rel_type
                        ORDER BY e.name LIMIT 40
                    """, dd_code=dd_code)
                    seen = set()
                    for ex in dd_exam_rs:
                        nm = clean_name_from_row(ex, 'pref', 'name', 'code')
                        if nm and nm not in seen:
                            seen.add(nm)
                            dd["exams"].append({
                                "name": nm, "code": ex["code"],
                                "purpose": "排除" if "exclusion" in (ex["rel_type"] or "").lower() else "辅助鉴别"
                            })
                except Exception:
                    pass
                try:
                    dd_lab_rs = sess.run("""
                        MATCH (dd:KGNode {code: $dd_code})-[r]->(l:KGNode)
                        WHERE l.entityType IN ['LabItem', 'LabSubitem']
                        OR type(r) IN ['requires_exclusion_lab', 'has_lab_item_for_differential']
                        RETURN DISTINCT l.code as code, l.name as name, l.preferred_name as pref,
                               l.display_name as dn, type(r) as rel_type
                        ORDER BY l.name LIMIT 40
                    """, dd_code=dd_code)
                    seen = set()
                    for lb in dd_lab_rs:
                        nm = clean_name_from_row(lb, 'pref', 'name', 'code')
                        if nm and nm not in seen:
                            seen.add(nm)
                            dd["labs"].append({
                                "name": nm, "code": lb["code"],
                                "purpose": "排除" if "exclusion" in (lb["rel_type"] or "").lower() else "辅助鉴别"
                            })
                except Exception:
                    pass
                # 图谱异常标记：泛化空壳标题 或 无任何鉴别规则
                generic = ('以下疾病' in dd["name"]) or ('需要考虑' in dd["name"])
                dd["anomaly"] = bool(generic or len(dd["rules"]) == 0)
                differentials.append(dd)
        except Exception:
            pass

        # 交叉标记：首诊检查/检验中，同时用于鉴别诊断的项目打 diff_purpose 标
        try:
            diff_exam_names = set()
            diff_lab_names = set()
            for dd in differentials:
                for ex in dd.get("exams", []):
                    if ex.get("name"):
                        diff_exam_names.add(ex["name"])
                for lb in dd.get("labs", []):
                    if lb.get("name"):
                        diff_lab_names.add(lb["name"])
            for plan in exam_plans:
                for it in plan.get("exam_items", []):
                    if it.get("name") in diff_exam_names:
                        it["diff_purpose"] = "鉴别诊断用"
                for it in plan.get("lab_items", []):
                    if it.get("name") in diff_lab_names:
                        it["diff_purpose"] = "鉴别诊断用"
        except Exception:
            pass

        # 资料覆盖：SourceSection 经"章节→实体"二跳关联到该疾病（Schema V3.2 资料追溯）
        source_section_count = 0
        source_sections = []
        try:
            ss_rs = sess.run("""
                MATCH (d:Disease {code: $code})-[]->(e:KGNode), (ss:KGNode {entityType:'SourceSection'})-[]->(e)
                RETURN DISTINCT ss.code AS ss_code, ss.source_name AS source_name,
                       ss.source_section_path AS path, ss.chapter_title AS chapter_title
                ORDER BY source_name, path
            """, code=code)
            for row in ss_rs:
                if row["ss_code"]:
                    source_section_count += 1
                    source_sections.append({
                        "code": row["ss_code"],
                        "source_name": row["source_name"] or "",
                        "source_section_path": row["path"] or "",
                        "chapter_title": row["chapter_title"] or "",
                    })
        except Exception:
            pass

        # 护理风险评估量表（Disease→护理评估→量表：条目分值/风险等级/总分规则，Schema V4.0 护理批次候选）
        nursing_scales = []
        try:
            sc_rows = sess.run("""
                MATCH (d:Disease {code: $code})-[:has_nursing_assessment]->(na:KGNode)-[:uses_assessment_scale]->(sc:AssessmentScale)
                WHERE (sc.status IS NULL OR sc.status <> 'deprecated')
                RETURN DISTINCT sc.code AS code, sc.name AS name
                ORDER BY name LIMIT 5
            """, code=code)
            for sc in sc_rows:
                sc_item = {"name": sc["name"] or "", "code": sc["code"], "items": [], "levels": [], "rule": ""}
                try:
                    it_rows = sess.run("""
                        MATCH (:AssessmentScale {code: $scode})-[:includes_assessment_item]->(it:KGNode)
                        WHERE (it.status IS NULL OR it.status <> 'deprecated')
                        RETURN DISTINCT it.name AS name, it.score_options AS so
                        ORDER BY name LIMIT 12
                    """, scode=sc["code"])
                    for it in it_rows:
                        opts = []
                        try:
                            opts = json.loads(it["so"]) if it["so"] else []
                        except Exception:
                            opts = []
                        sc_item["items"].append({"name": it["name"] or "", "options": opts})
                except Exception:
                    pass
                try:
                    lv_rows = sess.run("""
                        MATCH (:AssessmentScale {code: $scode})-[:has_result_level]->(lv:KGNode)
                        WHERE (lv.status IS NULL OR lv.status <> 'deprecated')
                        RETURN DISTINCT lv.name AS name, lv.rule_text AS rt
                        LIMIT 8
                    """, scode=sc["code"])
                    lv_order = [('极高危', 0), ('中高', 1), ('高危', 1), ('高风险', 1),
                                ('中风险', 2), ('中危', 2), ('低风险', 3), ('低危', 3), ('无风险', 4), ('无', 4)]
                    lvs = [{"name": lv["name"] or "", "rule": lv["rt"] or ""} for lv in lv_rows]
                    lvs.sort(key=lambda x: next((v for k, v in lv_order if k in x["name"]), 9))
                    sc_item["levels"] = lvs
                except Exception:
                    pass
                try:
                    tr = sess.run("""
                        MATCH (:AssessmentScale {code: $scode})-[:has_total_score_rule]->(tr:KGNode)
                        RETURN tr.rule_text AS rt LIMIT 1
                    """, scode=sc["code"]).single()
                    if tr and tr["rt"]:
                        sc_item["rule"] = tr["rt"]
                except Exception:
                    pass
                nursing_scales.append(sc_item)
        except Exception:
            pass

        return {
            "info": info,
            "dimensions": dimensions,
            "relations_summary": relations_summary,
            "evidence_count": ev_cnt,
            "guidelines": [e["name"] for e in dimensions.get("Guideline", [])],
            "pathways": pathways,
            "exam_plans": exam_plans,
            "differentials": differentials,
            "source_section_count": source_section_count,
            "source_sections": source_sections,
            "nursing_scales": nursing_scales,
        }


def query_global_stats():
    """全局统计 — 单次查询优化，Redis缓存（V2.0三层统计）
    4001整改：区分"图谱实例数"与"已映射CDSS标准字典数"两种口径，避免
    std_procedure_count=0 被误读为"图谱没有操作数据"。
    """
    cached = cache_get('kg:global_stats')
    if cached is not None:
        return cached
    d = get_driver()
    with d.session() as sess:
        # 单次查询获取所有统计（V2.0：新增三层统计 + 4001整改双口径）
        r = sess.run("""
            MATCH (n:KGNode)
            WITH
                count(CASE WHEN n.entityType = 'DiseaseCategory' THEN 1 END) AS disease_category_count,
                count(CASE WHEN n.entityType = 'Disease' THEN 1 END) AS disease_count,
                count(CASE WHEN n.entityType <> 'Evidence' OR n.entityType IS NULL THEN 1 END) AS visual_entity_count,
                count(*) AS kg_node_count,
                count(CASE WHEN n.entityType = 'Evidence' THEN 1 END) AS evidence_count,
                count(CASE WHEN n.entityType = 'StandardDiagnosis' THEN 1 END) AS std_diagnosis_count,
                count(CASE WHEN n.entityType = 'StandardProcedure' THEN 1 END) AS std_procedure_count,
                count(CASE WHEN n.entityType = 'SourceAdjudication' THEN 1 END) AS source_adjudication_count,
                count(CASE WHEN n.entityType = 'Procedure' THEN 1 END) AS procedure_instance_count,
                count(CASE WHEN n.entityType = 'Procedure' AND n.cdss_dict_id IS NOT NULL THEN 1 END) AS procedure_cdss_mapped_count,
                count(CASE WHEN n.entityType = 'ExamItem' THEN 1 END) AS exam_item_instance_count,
                count(CASE WHEN n.entityType = 'ExamItem' AND n.cdss_dict_id IS NOT NULL THEN 1 END) AS exam_item_cdss_mapped_count,
                count(CASE WHEN n.entityType = 'LabItem' THEN 1 END) AS lab_item_instance_count,
                count(CASE WHEN n.entityType = 'LabItem' AND n.cdss_dict_id IS NOT NULL THEN 1 END) AS lab_item_cdss_mapped_count,
                count(CASE WHEN n.entityType = 'Drug' THEN 1 END) AS drug_instance_count,
                count(CASE WHEN n.entityType = 'Drug' AND n.cdss_dict_id IS NOT NULL THEN 1 END) AS drug_cdss_mapped_count,
                count(CASE WHEN n.entityType = 'RecommendationStatement' THEN 1 END) AS rs_total_count,
                count(CASE WHEN n.entityType = 'RecommendationStatement'
                           AND n.clinical_review_status = 'clinical_ready' THEN 1 END) AS rs_reviewed_count,
                count(CASE WHEN n.entityType = 'RecommendationStatement'
                           AND n.clinical_review_status = 'blocked' THEN 1 END) AS rs_blocked_count,
                count(CASE WHEN n.entityType = 'RecommendationStatement'
                           AND n.clinical_review_status = 'pending' THEN 1 END) AS rs_pending_count,
                count(CASE WHEN n.entityType = 'RecommendationStatement'
                           AND n.formal_cdss_ready = true THEN 1 END) AS rs_formal_ready_count
            MATCH ()-[r]->()
            RETURN disease_category_count, disease_count, visual_entity_count,
                   kg_node_count, evidence_count, std_diagnosis_count,
                   std_procedure_count, source_adjudication_count, count(r) AS total_rels,
                   procedure_instance_count, procedure_cdss_mapped_count,
                   exam_item_instance_count, exam_item_cdss_mapped_count,
                   lab_item_instance_count, lab_item_cdss_mapped_count,
                   drug_instance_count, drug_cdss_mapped_count,
                   rs_total_count, rs_reviewed_count, rs_blocked_count, rs_pending_count,
                   rs_formal_ready_count
        """).single()

        result = {
            "disease_category_count": r["disease_category_count"],
            "disease_count": r["disease_count"],
            "visual_entity_count": r["visual_entity_count"],
            "kg_node_count": r["kg_node_count"],
            "evidence_count": r["evidence_count"],
            "total_relationships": r["total_rels"],
            # V2.0 三层统计
            "std_diagnosis_count": r["std_diagnosis_count"],
            "std_procedure_count": r["std_procedure_count"],
            "source_adjudication_count": r["source_adjudication_count"],
            # ===== 4001整改：双口径统计（图谱实例 vs CDSS标准字典映射）=====
            "instance_counts": {
                "procedure": r["procedure_instance_count"],
                "exam_item": r["exam_item_instance_count"],
                "lab_item": r["lab_item_instance_count"],
                "drug": r["drug_instance_count"],
            },
            "cdss_mapped_counts": {
                "procedure": r["procedure_cdss_mapped_count"],
                "exam_item": r["exam_item_cdss_mapped_count"],
                "lab_item": r["lab_item_cdss_mapped_count"],
                "drug": r["drug_cdss_mapped_count"],
            },
            "std_dict_node_counts": {
                "std_diagnosis": r["std_diagnosis_count"],
                "std_procedure": r["std_procedure_count"],
            },
            "stats_note": "图谱实例数=Neo4j中该entityType节点数；CDSS字典映射数=其中已具备cdss_dict_id的节点数；"
                          "std_procedure_count=StandardProcedure标准字典节点数（当前未建设，不代表图谱无操作数据，"
                          "操作实例见instance_counts.procedure）",
            # 推荐陈述审核四态（4001整改）
            "rs_review_stats": {
                "total": r["rs_total_count"],
                "clinical_ready": r["rs_reviewed_count"],
                "blocked": r["rs_blocked_count"],
                "pending": r["rs_pending_count"],
                "formal_cdss_ready": r["rs_formal_ready_count"],
            },
            # 兼容旧字段
            "total_nodes": r["kg_node_count"],
            "shell_entity_count": 0,
        }
        cache_set('kg:global_stats', result)
        return result


def query_data_version():
    """数据版本与时效信息 — 数据最后更新时间、节点关系计数、应用版本"""
    cached = cache_get('kg:data_version')
    if cached is not None:
        return cached
    d = get_driver()
    with d.session() as sess:
        # 节点最新更新时间 + 节点数
        r1 = sess.run("""
            MATCH (n:KGNode)
            RETURN max(n.updated_at) AS node_latest, count(n) AS node_count
        """).single()
        # 关系最新更新时间 + 关系数
        r2 = sess.run("""
            MATCH ()-[r]->()
            RETURN max(r.updated_at) AS rel_latest, count(r) AS rel_count
        """).single()
        
        node_latest = r1["node_latest"]
        rel_latest = r2["rel_latest"]
        # 取两者中较新的那个
        latest = None
        if node_latest and rel_latest:
            latest = max(node_latest, rel_latest)
        elif node_latest:
            latest = node_latest
        elif rel_latest:
            latest = rel_latest
        
        result = {
            "app_version": APP_VERSION,
            "data_updated_at": str(latest) if latest else None,
            "data_source": "Neo4j实时",
            "node_count": r1["node_count"],
            "relationship_count": r2["rel_count"],
        }
        cache_set('kg:data_version', result, ttl=60)  # 短缓存1分钟
        return result


def query_full_version():
    """完整版本信息（4001整改 3.1）：Schema标准版本 / 解析Skill版本 / 实例数据版本 /
    最近一次状态一致性回读时间（G8） / 前端版本 / API版本。
    不能只返回一个 APP_VERSION，让用户无法判断数据库实际处于什么版本。
    """
    cached = cache_get('kg:full_version')
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 1. 实例 schema_version 分布（判断实例版本是否与标准一致/混合）
        sv_rows = sess.run("""
            MATCH (n:KGNode)
            RETURN n.schema_version AS v, count(*) AS cnt
            ORDER BY cnt DESC
        """)
        instance_versions = {}
        for r in sv_rows:
            key = str(r["v"]) if r["v"] is not None else "未标注"
            instance_versions[key] = r["cnt"]

        # 2. 解析Skill版本分布（skill_version 可能为字符串或列表，Python侧聚合）
        skill_rows = sess.run("""
            MATCH (n:KGNode)
            WHERE n.skill_version IS NOT NULL
            RETURN n.skill_version AS sv, count(*) AS cnt
        """)
        skill_dist = {}
        for r in skill_rows:
            v = r["sv"]
            keys = sorted(set(v)) if isinstance(v, list) else [str(v)]
            for k in keys:
                skill_dist[k] = skill_dist.get(k, 0) + r["cnt"]

        # 3. 关键时间：数据最后更新 / V4.1迁移完成时间 / 状态一致性回读（G8）
        t = sess.run("""
            MATCH (n:KGNode)
            RETURN max(n.updated_at) AS data_updated,
                   max(n.schema_v41_migrated_at) AS v41_migrated,
                   max(n.status_consistency_updated_at) AS consistency_at,
                   count(n) AS node_count
        """).single()
        rel_t = sess.run("MATCH ()-[r]->() RETURN max(r.updated_at) AS rel_updated").single()

        # 4. 最近解析批次
        batch = sess.run("""
            MATCH (n:KGNode)
            WHERE n.batch_id IS NOT NULL
            RETURN n.batch_id AS b, max(n.updated_at) AS t
            ORDER BY t DESC LIMIT 1
        """).single()

    versions = sorted(instance_versions.keys())
    consistent = (len(versions) == 1 and versions[0] == SCHEMA_STANDARD_VERSION)
    if consistent:
        version_label = "标准版本%s / 实例版本统一%s" % (SCHEMA_STANDARD_VERSION, versions[0] if versions else "无")
    elif len(versions) == 0:
        version_label = "标准版本%s / 实例未标注版本" % SCHEMA_STANDARD_VERSION
    else:
        version_label = "标准版本%s / 实例版本混合(%s) / 待迁移复核" % (
            SCHEMA_STANDARD_VERSION, ", ".join(versions[:4]))

    # 当前解析Skill：取分布中的最新系列（按基础版本号排序，如 V1.40 < V2.1）
    skill_series = []
    for k in skill_dist:
        base = k.split('-')[0]
        if base not in skill_series:
            skill_series.append(base)

    def _ver_key(v):
        nums = re.findall(r'\d+', v)
        return [int(x) for x in nums] if nums else [0]
    skill_series.sort(key=_ver_key)
    current_skill = skill_series[-1] if skill_series else None

    data_updated = t["data_updated"] if t and t["data_updated"] else (rel_t["rel_updated"] if rel_t else None)

    result = {
        # 向后兼容：原接口只返回 {"version": "1.3.0"}
        "version": APP_VERSION,
        # 前端/API版本
        "app_version": APP_VERSION,
        "api_version": API_VERSION,
        # Schema标准与实例版本
        "schema_standard_version": SCHEMA_STANDARD_VERSION,
        "instance_schema_versions": instance_versions,
        "instance_version_consistent": consistent,
        "version_label": version_label,
        # 解析Skill版本
        "skill_version": current_skill,
        "skill_version_detail": skill_dist,
        "skill_version_note": "实例生产Skill版本分布；最新系列=%s，历史系列仅作溯源" % current_skill if current_skill else "无Skill版本记录",
        # 关键时间
        "data_updated_at": str(data_updated) if data_updated else None,
        "schema_v41_migrated_at": str(t["v41_migrated"]) if t and t["v41_migrated"] else None,
        "g8_readback_time": str(t["consistency_at"]) if t and t["consistency_at"] else None,
        "g8_readback_note": "最近一次状态一致性回读时间（对应生产流水线G8回读校验步骤）；无记录时以数据最后更新时间为准",
        "latest_batch_id": batch["b"] if batch else None,
        "latest_batch_time": str(batch["t"]) if batch else None,
        # 计数
        "node_count": t["node_count"] if t else 0,
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    cache_set('kg:full_version', result, ttl=60)
    return result


def query_schema_info():
    """返回数据库中实际的实体类型、关系类型及其数量，供图谱架构规范页面使用"""
    cached = cache_get('kg:schema_info')
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 实体类型及数量
        et_rows = sess.run("""
            MATCH (n:KGNode)
            WHERE n.entityType IS NOT NULL
            RETURN n.entityType AS et, count(*) AS cnt
            ORDER BY cnt DESC
        """)
        entity_types = [{"type": r["et"], "count": r["cnt"]} for r in et_rows]

        # 关系类型及数量
        rel_rows = sess.run("""
            MATCH ()-[r]->()
            RETURN type(r) AS rel, count(*) AS cnt
            ORDER BY cnt DESC
        """)
        rel_types = [{"type": r["rel"], "count": r["cnt"]} for r in rel_rows]

        # Disease diagnostic_role 分布
        role_rows = sess.run("""
            MATCH (d:Disease)
            RETURN d.diagnostic_role AS role, count(*) AS cnt
            ORDER BY cnt DESC
        """)
        disease_roles = [{"role": r["role"] or "unassigned", "count": r["cnt"]} for r in role_rows]

        # V2.0 关键关系统计
        v2_rels = {}
        for rel in ['has_disease', 'has_clinical_subtype', 'has_standard_diagnosis', 'has_category']:
            rows = sess.run(f"MATCH ()-[r:{rel}]->() RETURN count(*) AS cnt")
            for r in rows:
                v2_rels[rel] = r["cnt"]

        result = {
            "entity_types": entity_types,
            "relationship_types": rel_types,
            "disease_roles": disease_roles,
            "v2_relations": v2_rels,
            "total_entity_types": len(entity_types),
            "total_rel_types": len(rel_types)
        }

        cache_set('kg:schema_info', result)
        return result


def query_dimensions():
    """维度口径单一事实源（动态维度注册）。
    前端 app.js 启动时拉取本接口，动态更新 CORE_DIM_KEYS / CORE_DIM_NAMES / CORE_DIM_ALIAS / DIM_NAMES。
    Schema 升级（新增维度批次）只改 server.py 常量（REL_MAP/MULTI_HOP_DIMS/CORE_DIM_ORDER），
    前端零改动即可跟随新口径。纯常量计算，无 Neo4j 查询，响应即时。"""
    all_dims = list(REL_MAP.keys()) + list(MULTI_HOP_DIMS.keys())
    sub_dims = list(TWO_HOP_DIMS.keys())
    names = {}
    for k in all_dims + sub_dims:
        if k in ENTITY_NAME_MAP:
            names[k] = ENTITY_NAME_MAP[k]
    # 旧静态快照别名键也给中文名（降级模式下不显示英文）
    for new_k, legacy_k in DIM_ALIAS.items():
        if legacy_k not in names and new_k in ENTITY_NAME_MAP:
            names[legacy_k] = ENTITY_NAME_MAP[new_k]
    return {
        "schema_standard_version": SCHEMA_STANDARD_VERSION,
        "core_dimensions": CORE_DIM_ORDER,
        "core_dimension_count": len(CORE_DIM_ORDER),
        "all_dimensions": all_dims,
        "sub_dimensions": sub_dims,
        "names": names,
        "alias": DIM_ALIAS,
        "note": "core_dimensions=覆盖度计算分母（核心口径）；all_dimensions=dim_counts 可能出现的键；"
                "sub_dimensions=嵌套子维度（ExamObservation/LabSubitem/ThresholdRule）；"
                "names=中文名（ENTITY_NAME_MAP）；alias=旧静态快照键名兜底",
    }


def query_schema_registry():
    """图谱结构注册表（4001整改 4.9）：以 V4.1 注册表（ENTITY_NAME_MAP/REL_NAME_MAP）为基准，
    对照 Neo4j 实际数据，输出实体类型与关系类型的：
      - 中文名称/中文语义
      - 已注册 / 未注册（库里存在但注册表没有）
      - 状态：实例已存在 / 结构已定义·实例未落地（注册表有、库里无实例，含专病扩展槽位）
      - 关系类型的实际起点/终点实体类型（观测到的合法端点）
    供"图谱数据字典"页面按实体、关系、专科扩展、状态查询。
    同时落盘 schema_docs/图谱结构注册表.json 作为交付快照。
    """
    cache_key = "kg:schema_registry"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 库内实体类型计数
        et_rows = sess.run("""
            MATCH (n:KGNode)
            WHERE n.entityType IS NOT NULL
            RETURN n.entityType AS et, count(*) AS cnt
        """)
        et_counts = {r["et"]: r["cnt"] for r in et_rows}

        # 库内关系类型：计数 + 实际端点（起点/终点实体类型）
        rel_rows = sess.run("""
            MATCH (a:KGNode)-[r]->(b:KGNode)
            RETURN type(r) AS rt, count(*) AS cnt,
                   collect(DISTINCT a.entityType) AS start_types,
                   collect(DISTINCT b.entityType) AS end_types
        """)
        rel_obs = {}
        for r in rel_rows:
            rel_obs[r["rt"]] = {
                "count": r["cnt"],
                "start_types": sorted([x for x in (r["start_types"] or []) if x]),
                "end_types": sorted([x for x in (r["end_types"] or []) if x]),
            }

    # ---- 实体类型注册表 ----
    registered_ets = set(ENTITY_NAME_MAP.keys())
    db_ets = set(et_counts.keys())
    entity_registry = []
    for et in sorted(registered_ets | db_ets):
        cnt = et_counts.get(et, 0)
        entity_registry.append({
            "type": et,
            "name_cn": ENTITY_NAME_MAP.get(et, ""),
            "registered": et in registered_ets,
            "instance_count": cnt,
            "status": "实例已存在" if cnt > 0 else "结构已定义·实例未落地",
            "is_extension_slot": (et in registered_ets and cnt == 0),
        })
    unregistered_entity_types = sorted(db_ets - registered_ets)

    # ---- 关系类型注册表 ----
    registered_rels = set(REL_NAME_MAP.keys())
    db_rels = set(rel_obs.keys())
    relation_registry = []
    for rt in sorted(registered_rels | db_rels):
        obs = rel_obs.get(rt, {"count": 0, "start_types": [], "end_types": []})
        relation_registry.append({
            "type": rt,
            "name_cn": REL_NAME_MAP.get(rt, ""),
            "registered": rt in registered_rels,
            "instance_count": obs["count"],
            "start_entity_types": obs["start_types"],   # 观测到的合法起点
            "end_entity_types": obs["end_types"],       # 观测到的合法终点
            "status": "实例已存在" if obs["count"] > 0 else "结构已定义·实例未落地",
            "is_extension_slot": (rt in registered_rels and obs["count"] == 0),
        })
    unregistered_relation_types = sorted(db_rels - registered_rels)

    result = {
        "schema_standard_version": SCHEMA_STANDARD_VERSION,
        "generated_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "summary": {
            "entity_types_registered": len(registered_ets & db_ets),
            "entity_types_extension_slots": len(registered_ets - db_ets),
            "entity_types_unregistered": len(unregistered_entity_types),
            "relation_types_registered": len(registered_rels & db_rels),
            "relation_types_extension_slots": len(registered_rels - db_rels),
            "relation_types_unregistered": len(unregistered_relation_types),
        },
        "entity_types": entity_registry,
        "relation_types": relation_registry,
        "unregistered_entity_types": unregistered_entity_types,
        "unregistered_relation_types": unregistered_relation_types,
        "note": "注册表基准=代码内V4.1 ENTITY_NAME_MAP/REL_NAME_MAP；端点为Neo4j实际观测值；"
                "未注册=库中存在但注册表未定义（需复核）；扩展槽位=注册表已定义、实例待批次落地",
    }

    # 落盘快照（注册表交付物），失败不影响API
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        reg_dir = os.path.join(base_dir, 'schema_docs')
        if not os.path.isdir(reg_dir):
            os.makedirs(reg_dir, exist_ok=True)
        reg_file = os.path.join(reg_dir, '图谱结构注册表.json')
        with open(reg_file, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    cache_set(cache_key, result, ttl=300)
    return result


def query_guidelines():
    """获取所有指南及其关联疾病"""
    d = get_driver()
    with d.session() as sess:
        results = sess.run("""
            MATCH (g:Guideline)<-[:based_on_guideline]-(d:Disease)
            RETURN g.name as name, g.organization as org, g.year as year,
                   g.version as version, g.recommendation_level as level,
                   collect(DISTINCT {code: d.code, name: d.name}) as diseases
            ORDER BY g.year DESC, g.name
        """)
        guidelines = []
        for r in results:
            guidelines.append({
                "name": r["name"] or "",
                "organization": r["org"] or "",
                "year": r["year"] or "",
                "version": r["version"] or "",
                "level": r["level"] or "",
                "diseases": r["diseases"] or []
            })
        return {"guidelines": guidelines, "total": len(guidelines)}


def _extract_risk_threshold_sentences(text, limit=8):
    """从证据原文提取风险分层阈值句：含 高危/中危/低危 且带数值范围或分值比较"""
    import re
    segs = re.split(r"[。；;\n]", text or "")
    out = []
    for seg in segs:
        seg = seg.strip()
        if len(seg) < 6:
            continue
        if not re.search(r"(极高危|高危|中危|低危)", seg):
            continue
        if not re.search(r"[＞≥>≤＜<~～]\s*\d+|\d+\s*[~～]\s*\d+", seg):
            continue
        out.append(seg[:220])
        if len(out) >= limit:
            break
    return out


def query_entity_detail(code):
    """查询单个实体的详细信息（别名、英文名、关联疾病）"""
    d = get_driver()
    with d.session() as sess:
        r = sess.run("""
            MATCH (n:KGNode {code: $code})
            WHERE (n.status IS NULL OR n.status <> 'deprecated')
            RETURN n.name as name, n.code as code, n.name_en as name_en,
                   n.aliases as aliases, n.preferred_name as pref,
                   n.display_name as dn, n.status as status,
                   n.maps_to_disease_code as maps_to_disease_code, labels(n) as labels,
                   n.entityType as entityType, n.cdss_dict_id as cdss_dict_id,
                   n.clinical_review_status as review_status,
                   n.execution_status as execution_status,
                   n.source_section_path as source_section_path, n.source_name as source_name,
                   n.book_page_start as book_page_start, n.pdf_page_start as pdf_page_start,
                   n.inference_status as inference_status,
                   n.applicable_stage as applicable_stage,
                   n.applicable_disease_codes as applicable_disease_codes,
                   n.assessment_method as assessment_method,
                   n.care_context as care_context,
                   n.intervention_text as intervention_text,
                   n.outcome_definition as outcome_definition,
                   n.observation_method as observation_method,
                   n.recording_time_policy as recording_time_policy,
                   n.rule_text as rule_text,
                   n.applicable_population as applicable_population,
                   n.scoring_status as scoring_status,
                   n.terminology_mapping_status as terminology_mapping_status,
                   n.local_term_source_code as local_term_source_code,
                   n.abnormal_condition_text as abnormal_condition_text,
                   n.severity as severity,
                   n.trigger_event as trigger_event,
                   n.handling_strategy as handling_strategy,
                   n.data_quality_note as data_quality_note,
                   COUNT { (n)-[:supported_by_evidence]-() } as evidence_count
        """, code=code).single()
        if not r:
            return {"error": "Entity not found or deprecated", "code": code}

        # 查找关联疾病
        diseases = sess.run("""
            MATCH (d:Disease)-[rel]->(n:KGNode {code: $code})
            WHERE (d.status IS NULL OR d.status <> 'deprecated')
            RETURN DISTINCT d.name as disease_name, d.code as disease_code,
                   type(rel) as rel_type
            ORDER BY d.name LIMIT 20
        """, code=code)
        disease_list = [dict(rd) for rd in diseases]

        # 查找同名实体在其他疾病中的出现
        name = r["name"]
        cross_diseases = sess.run("""
            MATCH (d:Disease)-[rel]->(n:KGNode {name: $name})
            WHERE n.code <> $code AND (d.status IS NULL OR d.status <> 'deprecated')
                  AND (n.status IS NULL OR n.status <> 'deprecated')
            RETURN DISTINCT d.name as disease_name, d.code as disease_code,
                   type(rel) as rel_type
            ORDER BY d.name LIMIT 10
        """, name=name, code=code)
        cross_list = [dict(rd) for rd in cross_diseases]

        # 反向挂接（非疾病父实体，如护理评估→量表、护理计划→护理诊断；护理子实体溯源用）
        parent_rows = sess.run("""
            MATCH (p:KGNode)-[rel]->(n:KGNode {code: $code})
            WHERE (p.status IS NULL OR p.status <> 'deprecated')
              AND NOT p:Disease AND NOT p:Evidence
            RETURN DISTINCT p.code AS code, p.name AS name, p.entityType AS entityType,
                   type(rel) AS rel_type
            ORDER BY name LIMIT 10
        """, code=code)
        parent_list = [dict(x) for x in parent_rows]

        # RiskStratification 专属：评分参数（has_risk_factor）+ 证据阈值句 + 计分细则证据
        risk_detail = None
        if (r.get("entityType") or "") == "RiskStratification":
            # 评分名关键词（去掉 评分/风险分层/分级 后缀），阈值句按相关性排序用
            import re as _re
            kw = _re.sub(r"(风险分层|评分|分级|分层)$", "", (r["name"] or "")).strip()
            rf_rows = sess.run("""
                MATCH (n:KGNode {code: $code})-[rel:has_risk_factor]->(m:KGNode)
                WHERE (m.status IS NULL OR m.status <> 'deprecated')
                RETURN coalesce(m.preferred_name, m.display_name, m.name, m.code) AS name,
                       m.code AS code, rel.source AS source
                ORDER BY name
            """, code=code)
            risk_factors = [dict(x) for x in rf_rows]

            threshold_sentences = []
            seen_sent = set()
            criteria_evidence = []
            ev_rows = sess.run("""
                MATCH (n:KGNode {code: $code})-[:supported_by_evidence]->(ev:KGNode)
                RETURN ev.code AS code,
                       coalesce(ev.display_name, ev.preferred_name, ev.name, ev.code) AS name,
                       ev.source_name AS source_name, ev.source_page AS source_page,
                       ev.evidence_text AS evidence_text
            """, code=code)
            for row in ev_rows:
                txt = (row["evidence_text"] or "").strip()
                src = row["source_name"] or ""
                if row["source_page"]:
                    src += " p.%s" % row["source_page"]
                for seg in _extract_risk_threshold_sentences(txt):
                    if seg not in seen_sent:
                        seen_sent.add(seg)
                        threshold_sentences.append({"text": seg, "source": src})
                if txt and ("评分细则" in txt or ("项目" in txt and "得分" in txt)):
                    criteria_evidence.append({
                        "code": row["code"], "name": row["name"],
                        "source": src, "text": txt[:1000]
                    })
            # 含评分名关键词的阈值句排前面（PDF 双栏混排噪声句靠后），稳定排序保持原顺序
            threshold_sentences.sort(key=lambda t: 0 if (kw and kw in t["text"]) else 1)
            risk_detail = {
                "risk_factors": risk_factors,
                "threshold_sentences": threshold_sentences[:10],
                "criteria_evidence": criteria_evidence[:5],
                "inference_status": r.get("inference_status") or ""
            }

        # 护理批次专属（Schema V4.0）：子结构 / 量表条目与等级 / 质控规则指向
        nursing_detail = None
        _et = r.get("entityType") or ""
        nursing_sub_specs = []
        if _et == "NursingCarePlan":
            nursing_sub_specs = [
                ("护理诊断", "plan_has_nursing_diagnosis"),
                ("护理措施", "includes_nursing_intervention"),
                ("护理结局", "plan_targets_outcome"),
                ("护理评估", "plan_uses_assessment"),
            ]
        elif _et == "NursingAssessment":
            nursing_sub_specs = [
                ("评估条目", "has_nursing_assessment_item"),
                ("记录条目", "records_nursing_item"),
                ("评估量表", "uses_assessment_scale"),
            ]
        elif _et == "NursingDiagnosis":
            nursing_sub_specs = [
                ("护理措施", "has_nursing_intervention"),
                ("护理结局", "targets_nursing_outcome"),
            ]
        elif _et == "NursingIntervention":
            nursing_sub_specs = [
                ("记录条目", "records_nursing_item"),
                ("达成护理结局", "achieves_nursing_outcome"),
            ]
        elif _et == "NursingContraindication":
            nursing_sub_specs = [("限制的护理措施", "restricts_nursing_intervention")]
        elif _et == "AssessmentScale":
            nursing_sub_specs = [
                ("量表条目", "includes_assessment_item"),
                ("结果等级", "has_result_level"),
                ("总分规则", "has_total_score_rule"),
            ]
        elif _et == "QualityControlRule":
            nursing_sub_specs = [("核对对象", "checks_target")]

        if nursing_sub_specs:
            nursing_detail = {"groups": []}
            for sub_label, sub_rel in nursing_sub_specs:
                try:
                    sub_rows = sess.run(f"""
                        MATCH (n:KGNode {{code: $code}})-[:{sub_rel}]->(m:KGNode)
                        WHERE (m.status IS NULL OR m.status <> 'deprecated')
                        RETURN DISTINCT m.code AS code, m.name AS name, m.preferred_name AS pref,
                               coalesce(m.intervention_text, m.outcome_definition, m.assessment_method,
                                        m.observation_method, m.rule_text, '') AS text,
                               m.score_options AS score_options,
                               m.calculation_expression AS calculation_expression,
                               m.entityType AS entityType
                        ORDER BY name LIMIT 30
                    """, code=code)
                    sub_items = []
                    for sr in sub_rows:
                        sub_items.append({
                            "name": clean_name_from_row(sr, 'pref', 'name', 'code'),
                            "code": sr["code"],
                            "text": sr["text"] or "",
                            "score_options": sr["score_options"] or "",
                            "calculation_expression": sr["calculation_expression"] or "",
                            "entityType": sr["entityType"] or "",
                        })
                    if sub_items:
                        nursing_detail["groups"].append({"label": sub_label, "rel": sub_rel, "items": sub_items})
                except Exception:
                    pass
            # 质控规则指向（反向：QualityControlRule -checks_target-> 本实体）
            qc_rows = sess.run("""
                MATCH (q:QualityControlRule)-[:checks_target]->(n:KGNode {code: $code})
                WHERE (q.status IS NULL OR q.status <> 'deprecated')
                RETURN DISTINCT q.code AS code, q.name AS name, q.rule_text AS rule_text,
                       q.severity AS severity, q.trigger_event AS trigger_event
                ORDER BY q.name LIMIT 10
            """, code=code)
            nursing_detail["qc_rules"] = [dict(x) for x in qc_rows]
            if not nursing_detail["groups"] and not nursing_detail["qc_rules"]:
                nursing_detail = None

        aliases = [a for a in (r["aliases"] or []) if a != name]

        return {
            "name": clean_name_from_row(r, 'pref', 'name', 'code'),
            "code": code,
            "name_en": r["name_en"] or "",
            "aliases": aliases,
            "status": r.get("status") or "",
            "maps_to_disease_code": r.get("maps_to_disease_code") or "",
            "labels": r["labels"] or [],
            "entityType": r.get("entityType") or "",
            "cdss_dict_id": r.get("cdss_dict_id") or "",
            "clinical_review_status": r.get("review_status") or "",
            "execution_status": r.get("execution_status") or "",
            "source_section_path": r.get("source_section_path") or "",
            "source_name": r.get("source_name") or "",
            "book_page_start": r.get("book_page_start") or "",
            "pdf_page_start": r.get("pdf_page_start") or "",
            "evidence_count": r.get("evidence_count") or 0,
            # 护理批次字段（Schema V4.0，非护理实体为空串）
            "applicable_stage": r.get("applicable_stage") or "",
            "applicable_disease_codes": r.get("applicable_disease_codes") or "",
            "assessment_method": r.get("assessment_method") or "",
            "care_context": r.get("care_context") or "",
            "intervention_text": r.get("intervention_text") or "",
            "outcome_definition": r.get("outcome_definition") or "",
            "observation_method": r.get("observation_method") or "",
            "recording_time_policy": r.get("recording_time_policy") or "",
            "rule_text": r.get("rule_text") or "",
            "applicable_population": r.get("applicable_population") or "",
            "scoring_status": r.get("scoring_status") or "",
            "terminology_mapping_status": r.get("terminology_mapping_status") or "",
            "local_term_source_code": r.get("local_term_source_code") or "",
            "abnormal_condition_text": r.get("abnormal_condition_text") or "",
            "severity": r.get("severity") or "",
            "trigger_event": r.get("trigger_event") or "",
            "handling_strategy": r.get("handling_strategy") or "",
            "data_quality_note": r.get("data_quality_note") or "",
            "diseases": disease_list,
            "cross_diseases": cross_list,
            "parents": parent_list,
            "risk_detail": risk_detail,
            "nursing_detail": nursing_detail
        }


def query_action_evidence(disease_code, action_code):
    """查询推荐动作对应证据（4.1.1），解决'证据一箩筐'问题"""
    cache_key = f"action_evidence_{disease_code}_{action_code}"
    cached = cache_get(cache_key)
    if cached:
        return cached

    d = get_driver()
    with d.session() as sess:
        results = sess.run("""
            MATCH (d:KGNode {code: $diseaseCode})
            -[:has_specialty_care_pathway|includes_pathway_stage|includes_pathway_task|pathway_task_uses_action|has_treatment_plan|has_recommended_action|recommends_action*1..4]->(action:KGNode)
            WHERE action.code = $actionCode
            OPTIONAL MATCH (action)-[:supported_by_evidence]->(ev:KGNode)
            OPTIONAL MATCH (rule:KGNode)-[:recommends_action|blocks_action|has_recommended_action]->(action)
            OPTIONAL MATCH (rule)-[:supported_by_evidence]->(ruleEv:KGNode)
            WITH action, collect(DISTINCT ev) + collect(DISTINCT ruleEv) AS evidenceList
            RETURN
              action.code AS action_code,
              coalesce(action.display_name, action.preferred_name, action.name, action.code) AS action_name,
              [ev IN evidenceList WHERE ev IS NOT NULL | {
                evidence_code: ev.code,
                evidence_name: coalesce(ev.display_name, ev.preferred_name, ev.name, ev.code),
                guideline: ev.source_name,
                page: ev.source_page,
                recommendation_class: ev.recommendation_class,
                evidence_level: ev.evidence_level,
                source_text: ev.source_text
              }] AS evidence
        """, diseaseCode=disease_code, actionCode=action_code)

        result = []
        for r in results:
            action_evidence = {
                "action_code": r["action_code"],
                "action_name": r["action_name"],
                "evidence": r["evidence"] or [],
            }
            # 前端默认只展示1条主证据，其余放"展开更多"
            if action_evidence["evidence"]:
                action_evidence["primary_evidence"] = action_evidence["evidence"][0]
                action_evidence["more_evidence"] = action_evidence["evidence"][1:]
            else:
                action_evidence["primary_evidence"] = None
                action_evidence["more_evidence"] = []
            result.append(action_evidence)

        cache_set(cache_key, result)
        return result


def _build_rs_record(r):
    """将 RecommendationStatement 的 Neo4j Record 转为前端可用的 dict"""
    return {
        "code": r["rs_code"] or "",
        "name": clean_name_from_row(r, "rs_display", "rs_name", "rs_code"),
        "recommendation_class": r["rec_class"] or "",
        "evidence_level": r["ev_level"] or "",
        "recommendation_type": r["rec_type"] or "",
        "statement_text": r["stmt_text"] or "",
        "statement_summary": r["stmt_summary"] or "",
        # 改为返回actions数组
        "actions": [],
        "action_code": r["action_code"] or "",
        "action_name": clean_name_from_row(r, "action_display", "action_name", "action_code"),
        "action_entity_type": r["action_etype"] or "",
        "rule_name": r["rule_name"] or "",
        "rule_code": r["rule_code"] or "",
        "stage_name": r["stage_name"] or "",
        "stage_code": r["stage_code"] or "",
        "pathway_name": r["pathway_name"] or "",
        "pathway_code": r.get("pathway_code", "") or "",
        "clinical_review_status": r["review_status"] or "",
        "formal_cdss_ready": r["formal_ready"] or False,
        "indication_conditions": r["indication"] or "",
        "contraindication_conditions": r["contra"] or "",
        # 新增：主证据来源字段
        "primary_source_name": r.get("primary_source_name", "") or r.get("pg_name", "") or "",
        "primary_source_page": r.get("primary_source_page", "") or "",
        "primary_evidence_summary": r.get("primary_evidence_summary", "") or r.get("stmt_summary", "") or "",
        "primary_guideline_name": r.get("pg_name", "") or "",
        "primary_guideline_code": r.get("pg_code", "") or "",
        "primary_evidence_code": r.get("pe_code", "") or "",
    }


def query_disease_recommendations(disease_code):
    """正式CDSS推荐：按 RecommendationStatement.disease_code 属性过滤，只读 recommends_action 链
    不依赖 Disease -> has_recommendation_statement；
    不把 has_treatment_plan / stage_has_available_action 当正式推荐。

    4001整改（2026-09-19）：
    1. 证据链改为 supported_by_evidence（真实证据关系，库中9.2万条），
       derived_from 仅作兜底合并；based_on_guideline / uses_primary_guideline 保留。
    2. rule_name/stage_name/pathway_name 属性为空或占位(N/A)时，通过
       (ClinicalRule)-[:triggers_recommendation]->(RS)、
       (PathwayStage)-[:has_recommendation_statement]->(RS)、
       (SpecialtyCarePathway)-[:includes_pathway_stage]->(stage) 关系回填。
    3. clinical_review_status=blocked/pending 的推荐不再混入推荐结果，
       单独进入 blocked_recommendations（受阻/待审核清单）并给出阻断原因与缺失字段。
    4. 每条推荐带 usable / missing_fields / blocked_reasons 闭环字段，
       供前端按"可使用 / 审核通过待发布 / 待完善"分组展示。
    """
    cache_key = f"kg:recommendations_v4:{disease_code}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    d = get_driver()
    recommendations = []
    blocked_recommendations = []

    with d.session() as sess:
        rs = sess.run("""
            MATCH (rs:RecommendationStatement {disease_code: $code})
            OPTIONAL MATCH (rs)-[:recommends_action]->(action:KGNode)
            OPTIONAL MATCH (rs)-[:supported_by_evidence]->(ev:KGNode)
            OPTIONAL MATCH (rs)-[:derived_from]->(ev2:KGNode)
            OPTIONAL MATCH (rs)-[:based_on_guideline]->(g:KGNode)
            OPTIONAL MATCH (rs)-[:uses_primary_guideline]->(g2:KGNode)
            OPTIONAL MATCH (rs)-[:has_contraindication]->(contra:KGNode)
            OPTIONAL MATCH (rule:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(rs)
            OPTIONAL MATCH (stage:KGNode {entityType:'PathwayStage'})-[:has_recommendation_statement]->(rs)
            OPTIONAL MATCH (path:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(stage)
            RETURN rs.code AS rs_code, rs.display_name AS rs_display, rs.name AS rs_name,
                   rs.recommendation_class AS rec_class, rs.evidence_level AS ev_level,
                   rs.recommendation_type AS rec_type,
                   rs.statement_text AS stmt_text, rs.statement_summary AS stmt_summary,
                   rs.clinical_review_status AS review_status, rs.formal_cdss_ready AS formal_ready,
                   rs.cdss_use_status AS cdss_use_status, rs.cdss_release_level AS cdss_release_level,
                   rs.release_block_reasons AS block_reasons,
                   rs.indication_conditions AS indication, rs.contraindication_conditions AS contra,
                   rs.rule_name AS rule_name, rs.stage_name AS stage_name, rs.pathway_name AS pathway_name,
                   rs.primary_source_name AS primary_source_name,
                   rs.primary_source_page AS primary_source_page,
                   rule.name AS rel_rule_name,
                   stage.name AS rel_stage_name,
                   path.name AS rel_pathway_name,
                   collect(DISTINCT {
                       code: action.code,
                       name: coalesce(action.display_name, action.preferred_name, action.name, ''),
                       entityType: coalesce(action.entityType, '')
                   }) AS actions,
                   collect(DISTINCT {
                       code: ev.code,
                       name: coalesce(ev.display_name, ev.preferred_name, ev.name, ''),
                       source_name: coalesce(ev.source_name, ''),
                       source_page: coalesce(toString(ev.source_page), ''),
                       evidence_level: coalesce(ev.evidence_level, ''),
                       recommendation_class: coalesce(ev.recommendation_class, ''),
                       excerpt: left(coalesce(ev.evidence_text, ''), 300)
                   }) AS evidences,
                   collect(DISTINCT {
                       code: ev2.code,
                       name: coalesce(ev2.display_name, ev2.preferred_name, ev2.name, ''),
                       source_name: coalesce(ev2.source_name, ''),
                       source_page: coalesce(toString(ev2.source_page), ''),
                       evidence_level: coalesce(ev2.evidence_level, ''),
                       recommendation_class: coalesce(ev2.recommendation_class, ''),
                       excerpt: left(coalesce(ev2.evidence_text, ''), 300)
                   }) AS evidences2,
                   collect(DISTINCT {
                       code: contra.code,
                       name: coalesce(contra.display_name, contra.preferred_name, contra.name, '')
                   }) AS contraindications,
                   collect(DISTINCT g.name) AS guidelines,
                   collect(DISTINCT g2.name) AS guidelines2
            ORDER BY rs.name LIMIT 200
        """, code=disease_code)

        def _valid_name(v):
            """属性名有效性：空 / N/A / 无 视为缺失"""
            if v is None:
                return ""
            s = str(v).strip()
            return "" if s in ('', 'N/A', 'n/a', '无', 'null', 'None') else s

        for r in rs:
            actions = []
            seen_a = set()
            for a in (r["actions"] or []):
                if a and a.get("code") and a["code"] not in seen_a:
                    seen_a.add(a["code"])
                    actions.append(a)
            # 证据合并：supported_by_evidence 优先，derived_from 兜底去重
            evidences = []
            seen_e = set()
            for e in ((r["evidences"] or []) + (r["evidences2"] or [])):
                if e and e.get("code") and e["code"] not in seen_e:
                    seen_e.add(e["code"])
                    evidences.append(e)
            guidelines = []
            for g in (r["guidelines"] or []) + (r["guidelines2"] or []):
                if g and g not in guidelines:
                    guidelines.append(g)
            primary_guideline = guidelines[0] if guidelines else ""
            contraindications = []
            seen_c = set()
            for c in (r["contraindications"] or []):
                if c and c.get("code") and c["code"] not in seen_c:
                    seen_c.add(c["code"])
                    if c.get("name"):
                        contraindications.append(c)

            # 闭环字段：属性优先，为空时用关系回填（4001整改3）
            rule_name = _valid_name(r["rule_name"]) or _valid_name(r["rel_rule_name"])
            stage_name = _valid_name(r["stage_name"]) or _valid_name(r["rel_stage_name"])
            pathway_name = _valid_name(r["pathway_name"]) or _valid_name(r["rel_pathway_name"])

            # 缺失字段清单（4001整改：明确缺失项）
            missing_fields = []
            if not rule_name:
                missing_fields.append("rule_name")
            if not stage_name:
                missing_fields.append("stage_name")
            if not pathway_name:
                missing_fields.append("pathway_name")
            if not evidences:
                missing_fields.append("evidence")
            if not actions:
                missing_fields.append("action")

            review_status = r["review_status"] or ""
            formal_ready = bool(r["formal_ready"])
            usable = (review_status == 'clinical_ready' and formal_ready)

            # 阻断原因（兼容字符串/列表两种存储）
            br = r["block_reasons"]
            if br is None:
                br = []
            elif isinstance(br, str):
                br = [br]
            block_reasons = [str(x) for x in br]

            item = {
                "code": r["rs_code"] or "",
                "name": clean_name_from_row(r, "rs_display", "rs_name", "rs_code"),
                "recommendation_class": r["rec_class"] or "",
                "evidence_level": r["ev_level"] or "",
                "recommendation_type": r["rec_type"] or "",
                "statement_text": r["stmt_text"] or "",
                "statement_summary": r["stmt_summary"] or "",
                "actions": actions,
                "action_code": actions[0]["code"] if actions else "",
                "action_name": actions[0]["name"] if actions else "",
                "action_entity_type": actions[0]["entityType"] if actions else "",
                # 闭环字段（4001整改：属性+关系回填后的最终值；来源标注）
                "rule_name": rule_name,
                "stage_name": stage_name,
                "pathway_name": pathway_name,
                "closure_backfilled": {
                    "rule_name": (not _valid_name(r["rule_name"])) and bool(rule_name),
                    "stage_name": (not _valid_name(r["stage_name"])) and bool(stage_name),
                    "pathway_name": (not _valid_name(r["pathway_name"])) and bool(pathway_name),
                },
                "clinical_review_status": review_status,
                "formal_cdss_ready": formal_ready,
                "cdss_use_status": r["cdss_use_status"] or "",
                "cdss_release_level": r["cdss_release_level"] or "",
                "release_block_reasons": block_reasons,
                "usable": usable,
                "usable_label": ("可正式使用" if usable else
                                 "审核通过·待正式发布" if review_status == 'clinical_ready' else
                                 "待审核" if review_status == 'pending' else "已阻断"),
                "missing_fields": missing_fields,
                "closure_complete": len(missing_fields) == 0,
                "indication_conditions": r["indication"] or "",
                "contraindication_conditions": r["contra"] or "",
                "contraindications": contraindications,
                "primary_source_name": r["primary_source_name"] or primary_guideline,
                "primary_source_page": r["primary_source_page"] or "",
                "primary_guideline_name": primary_guideline,
                "guidelines": guidelines,
                "evidences": evidences,
            }

            # 4001整改：blocked/pending 不进入默认推荐结果
            if review_status in ('blocked', 'pending'):
                blocked_recommendations.append(item)
            else:
                recommendations.append(item)

    # 汇总（4001整改：推荐闭环统计）
    summary = {
        "total": len(recommendations) + len(blocked_recommendations),
        "usable": sum(1 for x in recommendations if x["usable"]),
        "reviewed_pending_release": sum(1 for x in recommendations if not x["usable"]),
        "blocked": sum(1 for x in blocked_recommendations if x["clinical_review_status"] == 'blocked'),
        "pending": sum(1 for x in blocked_recommendations if x["clinical_review_status"] == 'pending'),
        "missing_closure": sum(1 for x in recommendations if not x["closure_complete"]),
    }

    result = {
        "disease_code": disease_code,
        "recommendations": recommendations,
        "blocked_recommendations": blocked_recommendations,
        "summary": summary,
    }
    cache_set(cache_key, result, ttl=300)
    return result


def query_recommendation_detail(rs_code):
    """查询单条 RecommendationStatement 的完整证据链
    RS -> recommends_action/blocks_action
    RS -> derived_from Evidence
    RS -> based_on_guideline Guideline
    """
    cache_key = f"kg:rs_detail:{rs_code}"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 基本信息
        rs = sess.run("""
            MATCH (rs:KGNode {code: $code, entityType:'RecommendationStatement'})
            RETURN rs.code AS code, rs.display_name AS display_name, rs.name AS name,
                   rs.preferred_name AS pref_name,
                   rs.recommendation_class AS rec_class, rs.evidence_level AS ev_level,
                   rs.recommendation_type AS rec_type,
                   rs.statement_text AS stmt_text, rs.statement_summary AS stmt_summary,
                   rs.clinical_review_status AS review_status, rs.formal_cdss_ready AS formal_ready,
                   rs.indication_conditions AS indication, rs.contraindication_conditions AS contra,
                   rs.action_name AS action_name, rs.action_code AS action_code,
                   rs.rule_name AS rule_name, rs.rule_code AS rule_code,
                   rs.stage_name AS stage_name, rs.stage_code AS stage_code,
                   rs.pathway_name AS pathway_name, rs.pathway_code AS pathway_code,
                   rs.scope_disease_code AS scope_disease, rs.scope_target AS scope_target,
                   rs.required_patient_data AS required_data,
                   rs.primary_guideline_name AS pg_name, rs.primary_guideline_code AS pg_code,
                   rs.primary_evidence_code AS pe_code,
                   rs.primary_source_name AS primary_source_name,
                   rs.primary_source_page AS primary_source_page,
                   rs.primary_evidence_summary AS primary_evidence_summary,
                   rs.primary_evidence_raw_excerpt AS primary_evidence_raw_excerpt,
                   rs.evidence_link_count AS ev_link_count, rs.guideline_link_count AS gl_link_count
            LIMIT 1
        """, code=rs_code).single()

        if not rs:
            return {"error": "RecommendationStatement not found"}

        # 推荐动作
        actions = []
        act_rs = sess.run("""
            MATCH (rs:KGNode {code: $code})-[:recommends_action]->(a:KGNode)
            RETURN a.code AS code, coalesce(a.display_name, a.preferred_name, a.name, a.code) AS name,
                   a.entityType AS etype
            ORDER BY name LIMIT 20
        """, code=rs_code)
        for a in act_rs:
            actions.append({"code": a["code"], "name": a["name"], "entityType": a["etype"]})

        # 阻断动作
        blocks = []
        blk_rs = sess.run("""
            MATCH (rs:KGNode {code: $code})-[:blocks_action]->(b:KGNode)
            RETURN b.code AS code, coalesce(b.display_name, b.preferred_name, b.name, b.code) AS name,
                   b.entityType AS etype
            ORDER BY name LIMIT 20
        """, code=rs_code)
        for b in blk_rs:
            blocks.append({"code": b["code"], "name": b["name"], "entityType": b["etype"]})

        # 证据
        evidence = []
        ev_rs = sess.run("""
            MATCH (rs:KGNode {code: $code})-[:derived_from]->(ev:KGNode {entityType:'Evidence'})
            RETURN ev.code AS code, coalesce(ev.display_name, ev.preferred_name, ev.name, ev.code) AS name,
                   ev.source_file AS source_file, ev.source_page AS source_page,
                   ev.source_text AS source_text,
                   ev.recommendation_class AS rec_class, ev.evidence_level AS ev_level
            ORDER BY name LIMIT 30
        """, code=rs_code)
        for ev in ev_rs:
            evidence.append({
                "code": ev["code"], "name": ev["name"],
                "source_file": ev["source_file"] or "",
                "source_page": ev["source_page"] or "",
                "source_text": ev["source_text"] or "",
                "recommendation_class": ev["rec_class"] or "",
                "evidence_level": ev["ev_level"] or "",
            })

        # 指南
        guidelines = []
        gl_rs = sess.run("""
            MATCH (rs:KGNode {code: $code})-[:based_on_guideline]->(g:KGNode {entityType:'Guideline'})
            RETURN g.code AS code, coalesce(g.display_name, g.preferred_name, g.name, g.code) AS name,
                   g.organization AS org, g.year AS year, g.version AS version
            ORDER BY year DESC, name LIMIT 10
        """, code=rs_code)
        for gl in gl_rs:
            guidelines.append({
                "code": gl["code"], "name": gl["name"],
                "organization": gl["org"] or "", "year": gl["year"] or "",
                "version": gl["version"] or "",
            })

        result = {
            "code": rs["code"] or "",
            "name": rs["display_name"] or rs["name"] or "",
            "recommendation_class": rs["rec_class"] or "",
            "evidence_level": rs["ev_level"] or "",
            "recommendation_type": rs["rec_type"] or "",
            "statement_text": rs["stmt_text"] or "",
            "statement_summary": rs["stmt_summary"] or "",
            "clinical_review_status": rs["review_status"] or "",
            "formal_cdss_ready": rs["formal_ready"] or False,
            "indication_conditions": rs["indication"] or "",
            "contraindication_conditions": rs["contra"] or "",
            "rule_name": rs["rule_name"] or "",
            "rule_code": rs["rule_code"] or "",
            "stage_name": rs["stage_name"] or "",
            "stage_code": rs["stage_code"] or "",
            "pathway_name": rs["pathway_name"] or "",
            "pathway_code": rs["pathway_code"] or "",
            "scope_disease_code": rs["scope_disease"] or "",
            "scope_target": rs["scope_target"] or "",
            "required_patient_data": rs["required_data"] or "",
            "primary_guideline_name": rs["pg_name"] or "",
            "primary_guideline_code": rs["pg_code"] or "",
            "primary_evidence_code": rs["pe_code"] or "",
            # 新增：主证据来源字段
            "primary_source_name": rs.get("primary_source_name", "") or rs.get("pg_name", "") or "",
            "primary_source_page": rs.get("primary_source_page", "") or "",
            "primary_evidence_summary": rs.get("primary_evidence_summary", "") or rs.get("stmt_summary", "") or "",
            "primary_evidence_raw_excerpt": rs.get("primary_evidence_raw_excerpt", "") or "",
            "actions": actions,
            "blocks": blocks,
            "evidence": evidence,
            "primary_evidence": evidence[0] if evidence else None,
            "more_evidence": evidence[1:] if len(evidence) > 1 else [],
            "guidelines": guidelines,
            "primary_guideline": guidelines[0] if guidelines else None,
        }

    cache_set(cache_key, result, ttl=300)
    return result


def query_cdss_pathway(disease_code):
    """查询疾病的完整CDSS诊疗路径：路径->阶段->规则->推荐->动作/证据/指南"""
    d = get_driver()
    with d.session() as sess:
        # 1. 查询疾病信息
        disease_r = sess.run("""
            MATCH (d:KGNode {code: $code})
            RETURN d.code AS code, d.name AS name, d.display_name AS display_name
        """, code=disease_code).single()
        if not disease_r:
            return {"error": "Disease not found", "disease_code": disease_code}

        # 2. 查询CDSS路径（优先动态路径）
        pathways = sess.run("""
            MATCH (d:KGNode {code: $code})-[:has_specialty_care_pathway]->(p:KGNode)
            WHERE p.entityType = 'SpecialtyCarePathway'
            OPTIONAL MATCH (p)-[:includes_pathway_stage]->(s:KGNode)
            OPTIONAL MATCH (s)-[:has_clinical_rule]->(r:KGNode {entityType:'ClinicalRule'})
            OPTIONAL MATCH (r)-[:triggers_recommendation]->(rec:KGNode {entityType:'RecommendationStatement'})
            OPTIONAL MATCH (rec)-[:recommends_action]->(a:KGNode)
            OPTIONAL MATCH (rec)-[:blocks_action]->(ba:KGNode)
            OPTIONAL MATCH (rec)-[:derived_from]->(e:KGNode)
            OPTIONAL MATCH (rec)-[:based_on_guideline]->(g:KGNode)
            RETURN p.code AS pathway_code, p.name AS pathway_name, p.batch_id AS batch_id,
                   s.code AS stage_code, s.name AS stage_name, s.stage_order AS stage_order, s.stage_type AS stage_type,
                   r.code AS rule_code, r.name AS rule_name,
                   rec.code AS rec_code, rec.statement_text AS statement_text,
                   rec.recommendation_class AS rec_class, rec.evidence_level AS ev_level,
                   rec.primary_source_name AS primary_source_name,
                   rec.primary_source_page AS primary_source_page,
                   rec.primary_evidence_summary AS primary_evidence_summary,
                   rec.clinical_review_status AS review_status,
                   rec.formal_cdss_ready AS formal_ready,
                   collect(DISTINCT {code:a.code, name:coalesce(a.display_name,a.name,a.code), type:a.entityType}) AS actions,
                   collect(DISTINCT {code:ba.code, name:coalesce(ba.display_name,ba.name,ba.code), type:ba.entityType}) AS blocked,
                   collect(DISTINCT {code:e.code, name:coalesce(e.display_name,e.name,e.code), summary:e.summary, page:e.page, source_text:e.source_text}) AS evidences,
                   collect(DISTINCT {code:g.code, name:coalesce(g.display_name,g.name,g.code)}) AS guidelines
            ORDER BY s.stage_order, r.code, rec.code
        """, code=disease_code)

        # 3. 组装结果
        result = {
            "disease": {
                "code": disease_r["code"],
                "name": disease_r["display_name"] or disease_r["name"] or disease_r["code"]
            },
            "pathways": []
        }

        pathway_map = {}
        for r in pathways:
            pw_code = r["pathway_code"]
            if pw_code not in pathway_map:
                pathway_map[pw_code] = {
                    "code": pw_code,
                    "name": r["pathway_name"] or "",
                    "batch_id": r["batch_id"] or "",
                    "stages": []
                }
            pw = pathway_map[pw_code]

            # 找到或创建阶段
            stage_code = r["stage_code"]
            stage = None
            for s in pw["stages"]:
                if s["code"] == stage_code:
                    stage = s
                    break
            if not stage:
                stage = {
                    "code": stage_code or "",
                    "name": r["stage_name"] or "",
                    "order": r["stage_order"] or 0,
                    "type": r["stage_type"] or "",
                    "rules": []
                }
                pw["stages"].append(stage)

            # 找到或创建规则
            rule_code = r["rule_code"]
            rule = None
            for ru in stage["rules"]:
                if ru["code"] == rule_code:
                    rule = ru
                    break
            if not rule:
                rule = {
                    "code": rule_code or "",
                    "name": r["rule_name"] or "",
                    "recommendations": []
                }
                stage["rules"].append(rule)

            # 添加推荐
            if r["rec_code"]:
                rec = {
                    "code": r["rec_code"],
                    "statement_text": r["statement_text"] or "",
                    "recommendation_class": r["rec_class"] or "",
                    "evidence_level": r["ev_level"] or "",
                    "primary_source_name": r["primary_source_name"] or "",
                    "primary_source_page": r["primary_source_page"] or "",
                    "primary_evidence_summary": r["primary_evidence_summary"] or "",
                    "clinical_review_status": r["review_status"] or "",
                    "formal_cdss_ready": r["formal_ready"] or False,
                    "actions": [a for a in r["actions"] if a.get("code")],
                    "blocked": [b for b in r["blocked"] if b.get("code")],
                    "evidence": [e for e in r["evidences"] if e.get("code")],
                    "guidelines": [g for g in r["guidelines"] if g.get("code")]
                }
                rule["recommendations"].append(rec)

        result["pathways"] = list(pathway_map.values())
        return result


def query_cdss_diseases():
    """查询有CDSS路径的疾病列表（V2.0：使用标准诊断名称与疾病大类）"""
    cached = cache_get('kg:cdss:diseases')
    if cached is not None:
        return cached

    lookup = _disease_lookup_from_tree()
    d = get_driver()
    with d.session() as sess:
        rows = sess.run("""
            MATCH (d:Disease)
            WHERE """ + _active_node_filter('d') + """
              AND (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(p:KGNode {entityType:'SpecialtyCarePathway'})
                  RETURN count(DISTINCT p) AS pathway_count }
            CALL { WITH d
                  MATCH (d)-[:has_clinical_rule]->(rd:KGNode {entityType:'ClinicalRule'})
                  RETURN count(DISTINCT rd) AS rule_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(rec:KGNode {entityType:'RecommendationStatement'})
                  RETURN count(DISTINCT rec) AS recommendation_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(:KGNode {entityType:'RecommendationStatement'})-[:supported_by_evidence]->(e:KGNode)
                  RETURN count(DISTINCT e) AS evidence_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(:KGNode {entityType:'RecommendationStatement'})-[:based_on_guideline]->(g:KGNode)
                  RETURN count(DISTINCT g) AS guideline_count }
            RETURN d.code AS disease_code, pathway_count, rule_count,
                   recommendation_count, evidence_count, guideline_count
            ORDER BY disease_code
        """)

        diseases = []
        for r in rows:
            code = r["disease_code"]
            meta = lookup.get(code, {})
            if not meta:
                continue
            diseases.append({
                "disease_code": code,
                "disease_name": meta.get('name') or code,
                "parent_code": meta.get('category') or "",
                "diagnostic_role": meta.get('diagnostic_role') or "",
                "icd_code": meta.get('icd_code') or "",
                "pathway_count": r["pathway_count"],
                "rule_count": r["rule_count"],
                "recommendation_count": r["recommendation_count"],
                "evidence_count": r["evidence_count"],
                "guideline_count": r["guideline_count"]
            })

        cache_set('kg:cdss:diseases', diseases)
        return diseases


def query_cdss_coverage():
    """CDSS决策层覆盖分析：每个疾病的 路径/阶段/规则/推荐/动作/证据/指南 覆盖情况（V2.0）
    4001整改：就绪状态不再用"推荐≥5且证据≥3"的数量阈值判定。
    改为四层状态：结构已定义 → 实例已存在 → 审核已通过 → 可正式使用。
      structure_ready: 存在专科诊疗路径（结构骨架已定义）
      instance_ready:  存在推荐陈述实例
      review_ready:    存在临床审核通过(clinical_ready)的推荐
      usable_ready:    存在正式发布可用(formal_cdss_ready=true)的推荐
    status 取已达到的最高层，blocked_count 单列，绝不因"有规则有证据"直接判ready。
    """
    cache_key = "kg:cdss:coverage"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    lookup = _disease_lookup_from_tree()
    d = get_driver()
    with d.session() as sess:
        rows = sess.run("""
            MATCH (d:Disease)
            WHERE """ + _active_node_filter('d') + """
              AND (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(p:KGNode {entityType:'SpecialtyCarePathway'})
                  RETURN count(DISTINCT p) AS pathway_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(s:KGNode)
                  RETURN count(DISTINCT s) AS stage_count }
            CALL { WITH d
                  MATCH (d)-[:has_clinical_rule]->(rd:KGNode {entityType:'ClinicalRule'})
                  RETURN count(DISTINCT rd) AS rule_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(rec:KGNode {entityType:'RecommendationStatement'})
                  RETURN count(DISTINCT rec) AS rec_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(:KGNode {entityType:'RecommendationStatement'})-[:recommends_action]->(a:KGNode)
                  RETURN count(DISTINCT a) AS action_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(:KGNode {entityType:'RecommendationStatement'})-[:blocks_action]->(ba:KGNode)
                  RETURN count(DISTINCT ba) AS blocked_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(:KGNode {entityType:'RecommendationStatement'})-[:supported_by_evidence]->(e:KGNode)
                  RETURN count(DISTINCT e) AS evidence_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(:KGNode {entityType:'RecommendationStatement'})-[:based_on_guideline]->(g:KGNode)
                  RETURN count(DISTINCT g) AS guideline_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(rec3:KGNode {entityType:'RecommendationStatement'})
                  WHERE rec3.formal_cdss_ready = true
                  RETURN count(DISTINCT rec3) AS usable_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(rec4:KGNode {entityType:'RecommendationStatement'})
                  WHERE rec4.clinical_review_status = 'clinical_ready'
                  RETURN count(DISTINCT rec4) AS reviewed_count }
            CALL { WITH d
                  MATCH (d)-[:has_specialty_care_pathway]->(:KGNode {entityType:'SpecialtyCarePathway'})-[:includes_pathway_stage]->(:KGNode)-[:has_clinical_rule]->(:KGNode {entityType:'ClinicalRule'})-[:triggers_recommendation]->(rec5:KGNode {entityType:'RecommendationStatement'})
                  WHERE rec5.clinical_review_status = 'blocked'
                  RETURN count(DISTINCT rec5) AS blocked_rec_count }
            RETURN d.code AS disease_code, pathway_count, stage_count, rule_count,
                   rec_count, action_count + blocked_count AS action_count,
                   evidence_count, guideline_count, usable_count,
                   reviewed_count, blocked_rec_count
            ORDER BY disease_code
        """)

        result = []
        for r in rows:
            code = r["disease_code"]
            meta = lookup.get(code, {})
            if not meta:
                continue
            rec_count = r["rec_count"]
            usable_count = r["usable_count"]
            reviewed_count = r["reviewed_count"]
            # 四层状态判定（4001整改：结构→实例→审核→可用，逐层递进）
            structure_ready = r["pathway_count"] >= 1
            instance_ready = rec_count >= 1
            review_ready = reviewed_count >= 1
            usable_ready = usable_count >= 1
            if usable_ready:
                status = "usable"        # 可正式使用
            elif review_ready:
                status = "reviewed"      # 审核已通过，待正式发布
            elif instance_ready:
                status = "instance"      # 实例已存在，临床审核未通过
            elif structure_ready:
                status = "structure"     # 结构已定义，尚无推荐实例
            else:
                status = "none"
            result.append({
                "disease_code": code,
                "disease_name": meta.get('name') or code,
                "parent_code": meta.get('category') or "",
                "diagnostic_role": meta.get('diagnostic_role') or "",
                "icd_code": meta.get('icd_code') or "",
                "pathway_count": r["pathway_count"],
                "stage_count": r["stage_count"],
                "rule_count": r["rule_count"],
                "rec_count": rec_count,
                "action_count": r["action_count"],
                "evidence_count": r["evidence_count"],
                "guideline_count": r["guideline_count"],
                # 4001整改：四层覆盖 + 状态（ready_count 语义=可正式使用数，兼容旧字段名）
                "ready_count": usable_count,
                "reviewed_count": reviewed_count,
                "blocked_rec_count": r["blocked_rec_count"],
                "structure_ready": structure_ready,
                "instance_ready": instance_ready,
                "review_ready": review_ready,
                "usable_ready": usable_ready,
                "status": status,
                "status_label": {
                    "usable": "可正式使用", "reviewed": "审核已通过·待发布",
                    "instance": "实例已存在·待审核", "structure": "结构已定义·无实例",
                    "none": "无覆盖",
                }[status],
            })

        cache_set(cache_key, result)
        return result


def query_rs_review_summary():
    """查询全库 RecommendationStatement 审核状态汇总"""
    cache_key = "kg:rs_review_summary"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 总数
        total = sess.run(
            "MATCH (rs:KGNode {entityType:'RecommendationStatement'}) RETURN count(rs) as cnt"
        ).single()["cnt"]

        # formal_cdss_ready 分布
        ready = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            RETURN rs.formal_cdss_ready as ready, count(*) as cnt
        """)
        ready_dist = {}
        for r in ready:
            # 4001整改修正：布尔键统一小写（原"TRUE"写法永远取不到值）
            key = str(r["ready"]).lower() if r["ready"] is not None else "null"
            ready_dist[key] = r["cnt"]

        # clinical_review_status 分布
        review = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            RETURN rs.clinical_review_status as status, count(*) as cnt
        """)
        review_dist = {}
        for r in review:
            key = r["status"] or "未设置"
            review_dist[key] = r["cnt"]

        # cdss_use_status 分布（4001整改新增）
        use = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            RETURN rs.cdss_use_status as st, count(*) as cnt
        """)
        use_dist = {}
        for r in use:
            key = r["st"] or "未设置"
            use_dist[key] = r["cnt"]

        # 状态矛盾统计（4001整改新增）：审核受阻却标记正式推荐使用
        inconsistent = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            WHERE rs.clinical_review_status = 'blocked' AND rs.cdss_use_status = '正式推荐'
            RETURN count(rs) as cnt
        """).single()["cnt"]

        # recommendation_class 分布
        rec_class = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            RETURN rs.recommendation_class as cls, count(*) as cnt
        """)
        class_dist = {}
        for r in rec_class:
            key = r["cls"] or "未设置"
            class_dist[key] = r["cnt"]

        # evidence_level 分布
        ev_level = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            RETURN rs.evidence_level as level, count(*) as cnt
        """)
        level_dist = {}
        for r in ev_level:
            key = r["level"] or "未设置"
            level_dist[key] = r["cnt"]

        # recommendation_type 分布
        rec_type = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            RETURN rs.recommendation_type as type, count(*) as cnt
        """)
        type_dist = {}
        for r in rec_type:
            key = r["type"] or "未设置"
            type_dist[key] = r["cnt"]

        # 无动作 RS
        no_action = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            WHERE NOT (rs)-[:recommends_action]->() AND NOT (rs)-[:blocks_action]->()
            RETURN count(rs) as cnt
        """).single()["cnt"]

        # 无证据 RS（4001整改修正：真实证据关系是 supported_by_evidence，
        # 原来只查 derived_from 会把有证据的 RS 误报为无证据）
        no_evidence = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            WHERE NOT (rs)-[:supported_by_evidence]->() AND NOT (rs)-[:derived_from]->()
            RETURN count(rs) as cnt
        """).single()["cnt"]

        # 无指南 RS
        no_guideline = sess.run("""
            MATCH (rs:KGNode {entityType:'RecommendationStatement'})
            WHERE NOT (rs)-[:based_on_guideline]->() AND NOT (rs)-[:uses_primary_guideline]->()
            RETURN count(rs) as cnt
        """).single()["cnt"]

        result = {
            "total": total,
            "formal_cdss_ready": ready_dist.get("true", 0),
            "formal_cdss_not_ready": ready_dist.get("false", 0),
            "formal_cdss_ready_dist": ready_dist,
            "clinical_review_status": review_dist,
            "cdss_use_status": use_dist,
            "inconsistent_status_count": inconsistent,
            "inconsistent_status_note": "clinical_review_status=blocked 但 cdss_use_status=正式推荐的矛盾记录数（4001整改暴露）",
            "recommendation_class": class_dist,
            "evidence_level": level_dist,
            "recommendation_type": type_dist,
            "no_action_count": no_action,
            "no_evidence_count": no_evidence,
            "no_guideline_count": no_guideline,
            "gate_check": {
                "all_have_action": no_action == 0,
                "all_have_evidence": no_evidence == 0,
                "all_have_guideline": no_guideline == 0,
            }
        }

    cache_set(cache_key, result, ttl=300)
    return result


def query_skeleton_audit():
    """教材骨架质量控制审计（V1.11硬闸门）"""
    cache_key = "kg:skeleton_audit"
    cached = cache_get(cache_key)
    if cached is not None:
        return cached

    d = get_driver()
    with d.session() as sess:
        # 教材来源节点总数
        textbook_total = sess.run(
            "MATCH (n:KGNode) WHERE n.source_type = 'authoritative_textbook' RETURN count(n) as cnt"
        ).single()["cnt"]

        # skeleton_slot 分布
        slot_dist = {}
        rows = sess.run("""
            MATCH (n:KGNode) WHERE n.skeleton_slot IS NOT NULL AND n.skeleton_slot <> ''
            RETURN n.skeleton_slot as val, count(*) as cnt ORDER BY cnt DESC
        """)
        for r in rows:
            # 4001整改修复：skeleton_slot 可能为 list（历史批次），转字符串避免 dict 键不可哈希崩溃
            key = r["val"]
            if isinstance(key, list):
                key = "+".join(str(x) for x in key)
            slot_dist[key] = r["cnt"]

        # knowledge_layer 分布
        layer_dist = {}
        rows = sess.run("""
            MATCH (n:KGNode) WHERE n.knowledge_layer IS NOT NULL AND n.knowledge_layer <> ''
            RETURN n.knowledge_layer as val, count(*) as cnt ORDER BY cnt DESC
        """)
        for r in rows:
            # 4001整改修复：knowledge_layer 同样防御 list 类型
            key = r["val"]
            if isinstance(key, list):
                key = "+".join(str(x) for x in key)
            layer_dist[key] = r["cnt"]

        # source_type 分布
        source_dist = {}
        rows = sess.run("""
            MATCH (n:KGNode) WHERE n.source_type IS NOT NULL AND n.source_type <> ''
            RETURN n.source_type as val, count(*) as cnt ORDER BY cnt DESC
        """)
        for r in rows:
            # 4001整改修复：source_type 同样防御 list 类型
            key = r["val"]
            if isinstance(key, list):
                key = "+".join(str(x) for x in key)
            source_dist[key] = r["cnt"]

        # 硬闸门检查
        # 1. 教材核心无skeleton_slot
        no_slot = sess.run("""
            MATCH (n:KGNode) WHERE n.source_type = 'authoritative_textbook'
            AND (n.knowledge_layer = 'textbook_core' OR n.knowledge_layer IS NULL)
            AND (n.skeleton_slot IS NULL OR n.skeleton_slot = '')
            RETURN count(n) as cnt
        """).single()["cnt"]

        # 2. 教材来源无knowledge_layer
        no_layer = sess.run("""
            MATCH (n:KGNode) WHERE n.source_type = 'authoritative_textbook'
            AND (n.knowledge_layer IS NULL OR n.knowledge_layer = '')
            RETURN count(n) as cnt
        """).single()["cnt"]

        # 3. 教材来源无source_section_path
        no_section = sess.run("""
            MATCH (n:KGNode) WHERE n.source_type = 'authoritative_textbook'
            AND (n.source_section_path IS NULL OR n.source_section_path = '')
            RETURN count(n) as cnt
        """).single()["cnt"]

        # 4. 教材来源无页码
        no_page = sess.run("""
            MATCH (n:KGNode) WHERE n.source_type = 'authoritative_textbook'
            AND n.pdf_page_start IS NULL AND n.book_page_start IS NULL
            RETURN count(n) as cnt
        """).single()["cnt"]

        # 5. 教材来源无text_anchor
        no_anchor = sess.run("""
            MATCH (n:KGNode) WHERE n.source_type = 'authoritative_textbook'
            AND (n.text_anchor IS NULL OR n.text_anchor = '')
            RETURN count(n) as cnt
        """).single()["cnt"]

        # 6. 关系级skeleton_slot统计
        rel_slot_count = sess.run(
            "MATCH ()-[r]->() WHERE r.skeleton_slot IS NOT NULL AND r.skeleton_slot <> '' RETURN count(r) as cnt"
        ).single()["cnt"]

        rel_layer_count = sess.run(
            "MATCH ()-[r]->() WHERE r.knowledge_layer IS NOT NULL AND r.knowledge_layer <> '' RETURN count(r) as cnt"
        ).single()["cnt"]

        result = {
            "textbook_node_total": textbook_total,
            "skeleton_slot_distribution": slot_dist,
            "knowledge_layer_distribution": layer_dist,
            "source_type_distribution": source_dist,
            "gate_check": {
                "textbook_core_without_skeleton_slot": no_slot,
                "textbook_without_knowledge_layer": no_layer,
                "textbook_without_section_path": no_section,
                "textbook_without_page": no_page,
                "textbook_without_anchor": no_anchor,
                "relation_with_skeleton_slot": rel_slot_count,
                "relation_with_knowledge_layer": rel_layer_count,
                "all_pass": (no_slot == 0 and no_layer == 0 and no_section == 0 and no_page == 0 and no_anchor == 0),
            }
        }

    cache_set(cache_key, result, ttl=300)
    return result


# ============ 实例检索与编辑 API ============

EDITABLE_FIELDS = {
    'name', 'name_en', 'aliases', 'description', 'icd_code',
    'preferred_name', 'display_name'
}

REL_NAME_MAP = {
    'has_symptom': '症状关联', 'has_sign': '体征关联', 'has_complication': '并发症关联',
    'has_diagnostic_criteria': '诊断标准关联',
    'has_risk_factor': '危险因素关联',
    'has_etiology': '病因关联', 'has_complication': '并发症关联',
    'has_pathophysiology': '病理生理关联',
    'has_prognosis': '预后关联', 'has_followup': '随访关联',
    'has_risk_stratification': '风险分层关联',
    'has_epidemiology': '流行病学关联',
    'has_treatment_plan': '治疗方案关联',
    'differentiates_from': '鉴别诊断关联',
    'has_threshold_rule': '阈值规则关联',
    # 检查检验方案
    'has_exam_plan': '检查/检验方案', 'has_lab_plan': '检验方案',
    'includes_exam_item': '检查项目',
    'includes_lab_item': '检验项目',
    'exam_item_has_observation': '检查发现',
    'lab_item_has_subitem': '检验细项',
    'lab_item_has_observation': '检验发现',
    'uses_lab_sample': '检验标本',
    # 治疗与药品（Schema V4.1）
    'includes_drug': '方案药品', 'includes_procedure': '治疗手术',
    'includes_treatment_item': '治疗项目',
    'has_specific_drug': '具体药品', 'interacts_with': '药物相互作用',
    # 正式推荐链（Schema V4.1）
    'has_recommendation_statement': '推荐陈述关联',
    'triggers_recommendation': '触发推荐',
    'recommends_action': '推荐动作',
    'targets_differential_diagnosis': '服务于鉴别',
    'requires_pre_treatment_exam': '治疗前检查',
    'requires_pre_treatment_lab': '治疗前检验',
    'blocked_by_differential': '鉴别阻断',
    'has_alternative_action': '替代动作',
    'blocks_action': '阻断动作',
    'has_contraindication': '禁忌关联',
    'requires_exclusion_exam': '排除检查关联',
    'requires_exclusion_lab': '排除检验关联',
    # 证据链
    'supported_by_evidence': '证据支持',
    'has_evidence': '包含证据',
    'based_on_guideline': '依据指南',
    'uses_primary_guideline': '主依据指南',
    'uses_source_section': '使用来源章节',
    'has_source_section': '包含来源章节',
    'has_alias': '受控别名',
    # 其他既有
    'has_diagnostic_component': '诊断组件关联',
    'derived_from': '来源关联',
    'has_standard_diagnosis': '标准诊断关联',
    'has_source_adjudication': '来源裁决关联',
    'decides_recommendation': '形成推荐关联',
    'has_definition_component': '定义明细关联',
    'has_treatment_component': '治疗组件关联',
    'stage_has_available_action': '阶段可选动作',
    # 评估五件套（Schema V4.1）
    'has_assessment_scale': '适用评估量表',
    'includes_assessment_item': '评估评分项',
    'has_score_rule': '计分规则',
    'has_total_score_rule': '总分规则',
    'has_result_level': '结果等级',
    'determines_result_level': '判定等级',
    'supports_risk_stratification': '支撑风险分层',
    'triggers_assessment_action': '触发结果动作',
    'assessment_supported_by_evidence': '评估证据',
    'level_supported_by_evidence': '等级证据',
    'uses_assessment_scale': '复用量表',
    # 护理（Schema V4.1）
    'has_nursing_assessment': '护理评估关联',
    'has_nursing_assessment_item': '护理评估条目',
    'has_nursing_care_plan': '护理计划关联',
    'has_nursing_diagnosis': '护理诊断关联',
    'has_nursing_intervention': '护理措施关联',
    'targets_nursing_outcome': '护理结局目标',
    'achieves_nursing_outcome': '达成护理结局',
    'determines_nursing_grade': '判定护理分级',
    'plan_uses_assessment': '计划使用评估',
    'plan_has_nursing_diagnosis': '计划关联护理诊断',
    'plan_targets_outcome': '计划目标结局',
    'records_nursing_item': '护理记录项',
    'includes_nursing_intervention': '包含护理措施',
    'restricts_nursing_intervention': '约束护理措施',
    'checks_target': '核对对象',
    # 路径（Schema V4.1）
    'has_specialty_care_pathway': '专科诊疗路径',
    'has_inpatient_clinical_pathway': '住院临床路径',
    'includes_pathway_stage': '包含路径阶段',
    'includes_pathway_task': '包含路径任务',
    'pathway_task_uses_action': '任务绑定动作',
    'depends_on_task': '依赖前置任务',
    'next_pathway_stage': '后继阶段',
    'maps_to_pathway_task': '路径任务映射',
    'has_variation_reason': '变异原因',
    'has_exit_criteria': '出径/出院条件',
    # 质控（Schema V4.1）
    'has_quality_control_point': '质控点关联',
    'has_quality_control_rule': '质控规则关联',
    'checks_required_exam': '检查必需检查',
    'checks_required_lab': '检查必需检验',
    'checks_contraindication': '检查禁忌',
    'checks_assessment_level': '检查评估等级',
    'checks_pathway_task': '检查路径任务',
    'quality_rule_supported_by_evidence': '质控证据',
    # 目录与规则结构（V4.1 现行口径）
    'has_category': '疾病大类关联', 'has_subcategory': '疾病亚类关联',
    'has_disease': '疾病关联', 'has_definition': '定义关联',
    'has_prevention': '预防关联', 'has_clinical_rule': '临床规则关联',
    'has_clinical_subtype': '临床分型关联',
    'has_differential_diagnosis': '鉴别诊断关联', 'has_differential_rule': '鉴别规则关联',
    # 专病扩展槽位（V4.1 注册表已定义，库中待批次落地）
    'device_has_parameter': '设备参数关联',
    'diagnosis_criteria_uses_hemodynamic_indicator': '诊断标准用血流动力学指标',
    'disease_associated_gene': '疾病基因关联',
    'disease_has_blood_pressure_grade': '血压分级关联',
    'disease_has_clinical_subtype': '临床分型关联',
    'disease_has_ecg_pattern': '心电图模式关联',
    'disease_has_electrophysiology_mechanism': '电生理机制关联',
    'disease_has_heart_failure_phenotype': '心衰表型关联',
    'disease_has_infarct_location': '梗死部位关联',
    'disease_has_inheritance_pattern': '遗传方式关联',
    'disease_has_valve_anatomy': '瓣膜部位关联',
    'disease_has_valve_lesion_type': '瓣膜病变类型关联',
    'disease_needs_secondary_cause_exclusion': '继发病因排除关联',
    'exam_observation_indicates_vascular_territory': '冠脉区域提示关联',
    'procedure_targets_ablation_site': '消融位点关联',
    'procedure_uses_device': '器械使用关联',
    'recommendation_has_time_window': '推荐时间窗关联',
    'recommendation_requires_severity_grade': '推荐严重度关联',
    'recommendation_requires_volume_status': '推荐容量状态关联',
    'risk_stratification_uses_family_history': '风险分层用家族史',
    'risk_stratification_uses_target_organ_damage': '风险分层用靶器官损害',
}

ENTITY_NAME_MAP = {
    'Disease': '疾病', 'Specialty': '专科',
    'DiseaseCategory': '疾病大类', 'DiseaseSubcategory': '疾病亚类',
    'StandardDiagnosis': '标准诊断', 'StandardProcedure': '标准手术',
    'Definition': '定义', 'DefinitionComponent': '定义明细',
    'Etiology': '病因', 'Epidemiology': '流行病学',
    'Pathophysiology': '病理生理', 'Symptom': '症状',
    'Sign': '体征', 'RiskFactor': '危险因素',
    'Complication': '并发症', 'ExamItem': '检查项目',
    'ExamObservation': '检查发现', 'ExamPlan': '检查/检验方案',
    'LabItem': '检验项目', 'LabSubitem': '检验细项',
    'LabSample': '检验标本',
    'DiagnosisCriteria': '诊断标准', 'DiagnosisCriteriaComponent': '诊断标准明细',
    'RiskStratification': '风险分层',
    'Drug': '药品', 'Procedure': '手术/操作',
    'TreatmentPlan': '治疗方案', 'TreatmentItem': '治疗项目',
    'Prognosis': '预后', 'FollowUp': '随访',
    'DifferentialDiagnosis': '鉴别诊断', 'Contraindication': '禁忌',
    'Evidence': '证据', 'Guideline': '指南',
    'ThresholdRule': '阈值规则', 'Prevention': '预防',
    'ClinicalPathway': '诊疗路径', 'PathwayStage': '路径阶段',
    'ClinicalRule': '临床规则', 'RecommendationStatement': '推荐陈述',
    # Schema V4.1 评估五件套
    'AssessmentScale': '评估量表', 'AssessmentItem': '评估评分项',
    'AssessmentScoreRule': '计分规则', 'AssessmentResultLevel': '评分结果等级',
    'AssessmentActionRule': '结果动作规则',
    # Schema V4.1 护理十件套
    'NursingCarePlan': '护理计划', 'NursingAssessment': '护理评估',
    'NursingAssessmentItem': '护理评估条目', 'NursingDiagnosis': '护理诊断',
    'NursingIntervention': '护理措施', 'NursingOutcome': '护理结局',
    'NursingRecordItem': '护理记录条目', 'NursingGrade': '护理分级',
    'NursingContraindication': '护理禁忌', 'NursingOrderCheckRule': '护理医嘱核对',
    # Schema V4.1 路径与质控
    'SpecialtyCarePathway': '专科诊疗路径', 'InpatientClinicalPathway': '住院临床路径',
    'PathwayTask': '路径任务', 'PathwayVariationReason': '路径变异原因',
    'PathwayExitCriteria': '路径结束条件',
    'QualityControlPoint': '质控点', 'QualityControlRule': '质控规则',
    # 其他
    'SourceAdjudication': '来源裁决', 'SourceSection': '来源章节',
    'PatientState': '患者状态', 'ClinicalEvent': '临床事件',
    'VitalSignItem': '生命体征', 'MedicalTerm': '医学术语',
    'MedicalTermAlias': '医学术语别名',
    # 专病扩展槽位（V4.1 注册表已定义，库中待批次落地）
    'AblationTarget': '消融靶点', 'BloodPressureGrade': '血压分级',
    'ClinicalSubtype': '临床分型', 'Device': '器械设备', 'DeviceParameter': '设备参数',
    'ECGPattern': '心电图模式', 'ElectrophysiologyMechanism': '电生理机制',
    'FamilyHistory': '家族史', 'Gene': '基因', 'GeneticVariant': '基因变异',
    'HeartFailurePhenotype': '心衰表型', 'HemodynamicIndicator': '血流动力学指标',
    'InfarctLocation': '梗死部位', 'InheritancePattern': '遗传方式',
    'SecondaryCause': '继发病因', 'SeverityGrade': '严重程度',
    'TargetOrganDamage': '靶器官损害', 'TimeWindow': '时间窗',
    'ValveAnatomy': '瓣膜部位', 'ValveLesionType': '瓣膜病变类型',
    'VascularTerritory': '冠脉供血区域', 'VolumeStatus': '容量状态',
}


def write_audit_log(action, entity_code, operator, old_values, new_values):
    """写入审计日志（JSONL格式，每行一条）"""
    log_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'audit_log.jsonl')
    entry = {
        'timestamp': datetime.datetime.now().isoformat(),
        'action': action,
        'entity_code': entity_code,
        'operator': operator or 'anonymous',
        'old': old_values,
        'new': new_values
    }
    try:
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    except Exception as e:
        print(f"Audit log write failed: {e}")


def query_entities_search(q='', entity_type='', limit=50, offset=0, category=''):
    """全局实体搜索：按名称/编码/别名搜索，支持分页。
    category（疾病大类名）传入时按级联过滤：该大类疾病集合（含分型）+ 这些疾病的全部维度关联实体。
    实体类别/关键词在级联范围内继续生效；多映射范围通常数百级，内存合并分页。
    """
    d = get_driver()
    with d.session() as sess:
        # ============ 级联模式：疾病大类过滤 ============
        if category:
            tree = query_disease_tree()
            codes = []
            for cat in tree:
                if cat.get('name') == category:
                    for b in cat.get('children', []):
                        codes.append(b['code'])
                        for s in b.get('children', []):
                            codes.append(s['code'])
            if not codes:
                return {'items': [], 'total': 0, 'offset': offset, 'limit': limit, 'category': category}

            params = {'codes': codes}
            if q:
                params['q'] = q
            if entity_type:
                params['etype'] = entity_type
            q_filter = (" AND (n.name CONTAINS $q OR n.code CONTAINS $q OR n.name_en CONTAINS $q"
                        " OR any(a IN coalesce(n.aliases,[]) WHERE a CONTAINS $q))") if q else ""
            etype_filter = " AND n.entityType = $etype" if entity_type else ""
            # 全部类型模式排除支撑材料（量级 2.5 万的 Evidence 会淹没知识实体；可在左侧实体类别单独筛 Evidence）
            exclude_support = "" if entity_type else (" AND n.entityType <> 'Evidence'"
                                                      " AND n.entityType <> 'SourceSection'")
            # 结构性/目录/疾病层级关系不产生"知识实体"，排除
            struct_exclude = ("['belongs_to_category','belongs_to_subcategory','has_category','has_subcategory',"
                              "'has_disease','has_clinical_subtype','has_category',"
                              "'belongs_to_specialty','has_specialty']")
            ret_clause = ("RETURN n.code as code, n.name as name, n.entityType as entityType,"
                          " n.name_en as name_en, n.aliases as aliases,"
                          " n.preferred_name as pref, n.display_name as dn, dcs")

            merged = {}

            # 1) 一跳维度实体（双向，排除结构关系），附带关联疾病 code 供前端映射大类
            hop1_rows = list(sess.run(f"""
                MATCH (d:Disease)-[r]-(n:KGNode)
                WHERE d.code IN $codes AND n.entityType IS NOT NULL
                  AND (n.status IS NULL OR n.status <> 'deprecated')
                  AND NOT (type(r) IN {struct_exclude})
                  AND NOT (n.code IN $codes)
                  {etype_filter}
                  {exclude_support}
                  {q_filter}
                WITH DISTINCT n, d
                WITH n, collect(d.code)[0..8] AS dcs
                {ret_clause}
                ORDER BY n.name
            """, **params))
            for r in hop1_rows:
                merged[r['code']] = r

            # 2) 两跳维度实体（ExamItem/LabItem/Drug/Procedure，经 ExamPlan/TreatmentPlan 挂接）
            hop2_rows = list(sess.run(f"""
                MATCH (d:Disease)-[r1]->(p)-[r2]->(n:KGNode)
                WHERE d.code IN $codes
                  AND type(r1) IN ['has_exam_plan','has_treatment_plan']
                  AND type(r2) IN ['includes_exam_item','includes_lab_item','includes_drug','includes_procedure']
                  AND n.entityType IS NOT NULL
                  AND (n.status IS NULL OR n.status <> 'deprecated')
                  AND NOT (n.code IN $codes)
                  {etype_filter}
                  {exclude_support}
                  {q_filter}
                WITH DISTINCT n, d
                WITH n, collect(d.code)[0..8] AS dcs
                {ret_clause}
                ORDER BY n.name
            """, **params))
            for r in hop2_rows:
                if r['code'] not in merged:
                    merged[r['code']] = r

            # 3) 三跳维度实体（ThresholdRule/ExamObservation/LabSubitem，挂在 ExamItem/LabItem 下）
            hop3_rows = list(sess.run(f"""
                MATCH (d:Disease)-[:has_exam_plan]->(p)-[r2]->(i)-[r3]->(n:KGNode)
                WHERE d.code IN $codes
                  AND type(r2) IN ['includes_exam_item','includes_lab_item']
                  AND type(r3) IN ['has_threshold_rule','exam_item_has_observation','lab_item_has_subitem']
                  AND n.entityType IS NOT NULL
                  AND (n.status IS NULL OR n.status <> 'deprecated')
                  AND NOT (n.code IN $codes)
                  {etype_filter}
                  {exclude_support}
                  {q_filter}
                WITH DISTINCT n, d
                WITH n, collect(d.code)[0..8] AS dcs
                {ret_clause}
                ORDER BY n.name
            """, **params))
            for r in hop3_rows:
                if r['code'] not in merged:
                    merged[r['code']] = r

            # 4) 大类疾病本身（未指定类型或类型=Disease 时并入）
            if not entity_type or entity_type == 'Disease':
                dis_rows = list(sess.run(f"""
                    MATCH (n:KGNode)
                    WHERE n.code IN $codes AND n.entityType = 'Disease'
                      AND (n.status IS NULL OR n.status <> 'deprecated')
                      {q_filter}
                    RETURN n.code as code, n.name as name, n.entityType as entityType,
                           n.name_en as name_en, n.aliases as aliases,
                           n.preferred_name as pref, n.display_name as dn
                    ORDER BY n.name
                """, **params))
                for r in dis_rows:
                    if r['code'] not in merged:
                        row = dict(r)
                        row['dcs'] = [r['code']]
                        merged[r['code']] = row

            items_sorted = sorted(merged.values(), key=lambda x: (x['name'] or x['code'] or ''))
            total = len(items_sorted)
            page = items_sorted[offset:offset + limit]
            result = []
            for r in page:
                # 显示名走统一清洗链（剥离"1.定义依据"等编号前缀）
                name = clean_name_from_row(r)
                result.append({
                    'code': r['code'],
                    'name': name,
                    'entityType': r['entityType'] or '',
                    'name_en': r['name_en'] or '',
                    'aliases': r['aliases'] or [],
                    'disease_codes': list(r.get('dcs') or []),
                })
            return {'items': result, 'total': total, 'offset': offset, 'limit': limit, 'category': category}

        # ============ 默认模式：全库检索（原逻辑） ============
        params = {'limit': limit, 'skip': offset}
        if q:
            params['q'] = q
        if entity_type:
            params['etype'] = entity_type

        # 构建WHERE条件
        where_clauses = []
        if entity_type:
            where_clauses.append('n.entityType = $etype')
        if q:
            where_clauses.append('(n.name CONTAINS $q OR n.code CONTAINS $q OR n.name_en CONTAINS $q OR any(a IN coalesce(n.aliases,[]) WHERE a CONTAINS $q))')
        where_str = 'WHERE ' + ' AND '.join(where_clauses) if where_clauses else 'WHERE n.entityType IS NOT NULL'

        # 查询总数
        count_cypher = f"MATCH (n:KGNode) {where_str} RETURN count(n) as total"
        total = sess.run(count_cypher, **params).single()['total']

        # 查询当前页数据
        cypher = f"""
            MATCH (n:KGNode)
            {where_str}
            RETURN n.code as code, n.name as name, n.entityType as entityType,
                   n.name_en as name_en, n.aliases as aliases,
                   n.preferred_name as pref, n.display_name as dn
            ORDER BY n.name
            SKIP $skip LIMIT $limit
        """
        rows = sess.run(cypher, **params)
        result = []
        for r in rows:
            name = r['dn'] or r['pref'] or r['name'] or r['code']
            result.append({
                'code': r['code'],
                'name': name,
                'entityType': r['entityType'] or '',
                'name_en': r['name_en'] or '',
                'aliases': r['aliases'] or [],
            })
        return {'items': result, 'total': total, 'offset': offset, 'limit': limit}


def query_subgraph(code, hop=1, limit=50):
    """获取节点的邻居子图（1-hop）"""
    d = get_driver()
    with d.session() as sess:
        center = sess.run("""
            MATCH (n:KGNode {code: $code})
            RETURN n.code as code, n.name as name, n.entityType as entityType,
                   n.name_en as name_en, n.aliases as aliases,
                   n.description as description, n.icd_code as icd_code,
                   n.preferred_name as pref, n.display_name as dn,
                   n.parentCode as parentCode, n.schema_version as schema_version
        """, code=code).single()
        if not center:
            return {'error': 'Node not found', 'code': code}

        rows = sess.run("""
            MATCH (n:KGNode {code: $code})-[r]-(m:KGNode)
            WHERE NOT type(r) IN ['belongs_to_category','belongs_to_subcategory','has_category','has_subcategory']
            RETURN m.code as code, m.name as name, m.entityType as entityType,
                   m.name_en as name_en, m.aliases as aliases,
                   m.preferred_name as pref, m.display_name as dn,
                   type(r) as rel_type,
                   CASE WHEN startNode(r) = n THEN 'out' ELSE 'in' END as rel_dir,
                   r.evidence_id as evidence_id, r.source_name as source_name
            LIMIT $limit
        """, code=code, limit=limit)

        neighbors = []
        for r in rows:
            name = r['dn'] or r['pref'] or r['name'] or r['code']
            neighbors.append({
                'code': r['code'],
                'name': name,
                'entityType': r['entityType'] or '',
                'name_en': r['name_en'] or '',
                'aliases': r['aliases'] or [],
                'rel_type': r['rel_type'],
                'rel_dir': r['rel_dir'],
                'evidence_id': r['evidence_id'] or '',
                'source_name': r['source_name'] or ''
            })

        center_name = center['dn'] or center['pref'] or center['name'] or center['code']
        return {
            'center': {
                'code': center['code'],
                'name': center_name,
                'entityType': center['entityType'] or '',
                'name_en': center['name_en'] or '',
                'aliases': center['aliases'] or [],
                'description': center['description'] or '',
                'icd_code': center['icd_code'] or '',
                'parentCode': center['parentCode'] or '',
                'schema_version': center['schema_version'] or ''
            },
            'neighbors': neighbors
        }


def update_entity_properties(code, fields, operator='admin'):
    """更新实体属性（仅允许白名单字段）"""
    safe_fields = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
    if not safe_fields:
        return {'error': 'No editable fields provided', 'allowed': list(EDITABLE_FIELDS)}

    d = get_driver()
    with d.session() as sess:
        old_r = sess.run("""
            MATCH (n:KGNode {code: $code})
            RETURN n.name as name, n.name_en as name_en, n.aliases as aliases,
                   n.description as description, n.icd_code as icd_code,
                   n.preferred_name as preferred_name, n.display_name as display_name
        """, code=code).single()
        if not old_r:
            return {'error': 'Entity not found', 'code': code}

        old_values = {}
        for k in safe_fields:
            old_values[k] = old_r[k] if k in old_r.keys() else None

        set_parts = []
        params = {'code': code}
        for k, v in safe_fields.items():
            param_key = 'new_' + k
            set_parts.append(f'n.{k} = ${param_key}')
            params[param_key] = v

        set_clause = ', '.join(set_parts)
        sess.run(f"""
            MATCH (n:KGNode {{code: $code}})
            SET {set_clause}
        """, **params)

        write_audit_log('update', code, operator, old_values, safe_fields)

        r = get_redis()
        if r:
            r.flushall()

        return {'status': 'ok', 'code': code, 'updated_fields': list(safe_fields.keys()), 'old_values': old_values}


def create_entity_and_link(name, entity_type, from_code, rel_type, operator='admin', extra_fields=None):
    """创建新实体并关联到现有节点"""
    import uuid
    d = get_driver()
    with d.session() as sess:
        src = sess.run("MATCH (n:KGNode {code: $code}) RETURN n.entityType as et", code=from_code).single()
        if not src:
            return {'error': 'Source node not found', 'code': from_code}

        prefix = entity_type.upper()[:6]
        new_code = f"{prefix}-{uuid.uuid4().hex[:12].upper()}"

        props = {
            'code': new_code,
            'name': name,
            'entityType': entity_type,
            'schema_version': 'V1.12',
            'review_status': 'draft',
            'created_time': datetime.datetime.now().isoformat()
        }
        if extra_fields:
            for k, v in extra_fields.items():
                if k in EDITABLE_FIELDS:
                    props[k] = v

        prop_parts = []
        for k in props:
            prop_parts.append(f'{k}: ${k}')
        prop_cypher = '{' + ', '.join(prop_parts) + '}'

        sess.run(f"""
            CREATE (n:KGNode:{entity_type} {prop_cypher})
        """, **props)

        sess.run(f"""
            MATCH (from:KGNode {{code: $from_code}}), (to:KGNode {{code: $to_code}})
            MERGE (from)-[:`{rel_type}`]->(to)
        """, from_code=from_code, to_code=new_code)

        write_audit_log('create', new_code, operator, None, {'name': name, 'entityType': entity_type, 'linked_to': from_code, 'rel_type': rel_type})

        r = get_redis()
        if r:
            r.flushall()

        return {'status': 'ok', 'code': new_code, 'name': name, 'entityType': entity_type, 'linked_to': from_code, 'rel_type': rel_type}


def add_relation(from_code, to_code, rel_type, operator='admin'):
    """关联两个已存在的实体（用现有关系类型）"""
    d = get_driver()
    with d.session() as sess:
        from_node = sess.run("MATCH (n:KGNode {code: $code}) RETURN n.name as name", code=from_code).single()
        to_node = sess.run("MATCH (n:KGNode {code: $code}) RETURN n.name as name", code=to_code).single()
        if not from_node:
            return {'error': 'Source node not found', 'code': from_code}
        if not to_node:
            return {'error': 'Target node not found', 'code': to_code}

        existing = sess.run(f"""
            MATCH (a:KGNode {{code: $from_code}})-[:`{rel_type}`]->(b:KGNode {{code: $to_code}})
            RETURN count(a) as cnt
        """, from_code=from_code, to_code=to_code).single()
        if existing and existing['cnt'] > 0:
            return {'error': 'Relation already exists', 'from': from_code, 'to': to_code, 'rel': rel_type}

        sess.run(f"""
            MATCH (a:KGNode {{code: $from_code}}), (b:KGNode {{code: $to_code}})
            MERGE (a)-[:`{rel_type}`]->(b)
        """, from_code=from_code, to_code=to_code)

        write_audit_log('link', from_code, operator, None, {'to': to_code, 'rel_type': rel_type})

        r = get_redis()
        if r:
            r.flushall()

        return {'status': 'ok', 'from': from_code, 'to': to_code, 'rel_type': rel_type}


def remove_relation(from_code, to_code, rel_type, operator='admin'):
    """断开两个实体之间的关系"""
    d = get_driver()
    with d.session() as sess:
        existing = sess.run(f"""
            MATCH (a:KGNode {{code: $from_code}})-[r:`{rel_type}`]->(b:KGNode {{code: $to_code}})
            RETURN count(r) as cnt
        """, from_code=from_code, to_code=to_code).single()
        if not existing or existing['cnt'] == 0:
            return {'error': 'Relation not found', 'from': from_code, 'to': to_code, 'rel': rel_type}

        sess.run(f"""
            MATCH (a:KGNode {{code: $from_code}})-[r:`{rel_type}`]->(b:KGNode {{code: $to_code}})
            DELETE r
        """, from_code=from_code, to_code=to_code)

        write_audit_log('unlink', from_code, operator, {'to': to_code, 'rel_type': rel_type}, None)

        r = get_redis()
        if r:
            r.flushall()

        return {'status': 'ok', 'from': from_code, 'to': to_code, 'rel_type': rel_type, 'message': 'Relation removed'}


def query_entity_types_stats():
    """获取所有entityType和关系类型的分布统计"""
    d = get_driver()
    with d.session() as sess:
        et_rows = sess.run("""
            MATCH (n:KGNode)
            WHERE n.entityType IS NOT NULL
            RETURN n.entityType as type, count(n) as cnt
            ORDER BY cnt DESC
        """)
        entity_types = {}
        for r in et_rows:
            entity_types[r['type']] = r['cnt']

        rt_rows = sess.run("""
            MATCH ()-[r]->()
            RETURN type(r) as type, count(r) as cnt
            ORDER BY cnt DESC
        """)
        rel_types = {}
        for r in rt_rows:
            rel_types[r['type']] = r['cnt']

        return {
            'entity_types': entity_types,
            'rel_types': rel_types
        }


import socketserver
import threading
import gzip

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

class KGHandler(http.server.SimpleHTTPRequestHandler):
    """自定义HTTP处理器：API路由 + 静态文件"""

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # ---- POST /api/kg/flush-cache ----
        if path == '/api/kg/flush-cache':
            try:
                r = get_redis()
                if r:
                    r.flushall()
                    self._json_response({"status": "ok", "message": "Redis cache cleared"})
                else:
                    self._json_response({"status": "ok", "message": "No Redis, using memory cache"})
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # ---- POST /api/kg/diagnose ----
        if path == '/api/kg/diagnose':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length)) if length else {}
            except Exception:
                self._json_response({"error": "Invalid JSON body"}, 400)
                return

            # 支持step参数，默认为"auto"（一次性返回所有结果）
            step = body.get('step', 'auto')

            # 缓存键（包含step参数）
            cache_key = 'kg:diagnose:' + step + ':' + json.dumps(body, sort_keys=True, ensure_ascii=False)
            cached = cache_get(cache_key)
            if cached is not None:
                self._json_response(cached)
                return

            result = self._run_diagnose(body, step)
            cache_set(cache_key, result)
            self._json_response(result)
            return

        # ---- POST /api/kg/entity/update ----
        if path == '/api/kg/entity/update':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length)) if length else {}
            except Exception:
                self._json_response({"error": "Invalid JSON body"}, 400)
                return
            code = body.get('code', '')
            fields = body.get('fields', {})
            operator = body.get('operator', 'admin')
            if not code or not fields:
                self._json_response({"error": "code and fields required"}, 400)
                return
            try:
                self._json_response(update_entity_properties(code, fields, operator))
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # ---- POST /api/kg/entity/create ----
        if path == '/api/kg/entity/create':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length)) if length else {}
            except Exception:
                self._json_response({"error": "Invalid JSON body"}, 400)
                return
            name = body.get('name', '')
            entity_type = body.get('entityType', '')
            from_code = body.get('from_code', '')
            rel_type = body.get('rel_type', '')
            operator = body.get('operator', 'admin')
            extra = body.get('extra_fields', {})
            if not name or not entity_type or not from_code or not rel_type:
                self._json_response({"error": "name, entityType, from_code, rel_type required"}, 400)
                return
            try:
                self._json_response(create_entity_and_link(name, entity_type, from_code, rel_type, operator, extra))
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # ---- POST /api/kg/relation/add ----
        if path == '/api/kg/relation/add':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length)) if length else {}
            except Exception:
                self._json_response({"error": "Invalid JSON body"}, 400)
                return
            from_code = body.get('from_code', '')
            to_code = body.get('to_code', '')
            rel_type = body.get('rel_type', '')
            operator = body.get('operator', 'admin')
            if not from_code or not to_code or not rel_type:
                self._json_response({"error": "from_code, to_code, rel_type required"}, 400)
                return
            try:
                self._json_response(add_relation(from_code, to_code, rel_type, operator))
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # ---- POST /api/kg/relation/remove ----
        if path == '/api/kg/relation/remove':
            try:
                length = int(self.headers.get('Content-Length', 0))
                body = json.loads(self.rfile.read(length)) if length else {}
            except Exception:
                self._json_response({"error": "Invalid JSON body"}, 400)
                return
            from_code = body.get('from_code', '')
            to_code = body.get('to_code', '')
            rel_type = body.get('rel_type', '')
            operator = body.get('operator', 'admin')
            if not from_code or not to_code or not rel_type:
                self._json_response({"error": "from_code, to_code, rel_type required"}, 400)
                return
            try:
                self._json_response(remove_relation(from_code, to_code, rel_type, operator))
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        self._json_response({"error": "Not found"}, 404)

    def do_OPTIONS(self):
        """处理 CORS 预检请求（POST /api/kg/diagnose 需要）"""
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '86400')
        self.end_headers()

    def _run_diagnose(self, body, step='auto'):
        """核心诊断逻辑：图谱查询 + 评分计算 + 治疗方案匹配
        step 参数支持阶段驱动推理：
          'auto'               — 默认，返回完整结果（向后兼容）
          1 / 'screening'      — 高危筛查
          2 / 'disease_recommendation' — 专病候选推荐
          3 / 'confirm_pathway'       — 确认入径
          4+ / 'stage_push'           — 阶段推进
        """
        # --- 1. 解析输入字段 ---
        chief   = body.get('chief_complaint', '') or ''
        ecg     = body.get('ecg_result', '') or ''
        troponin = body.get('troponin', '') or ''
        ckmb    = body.get('ckmb', '') or ''
        bp_syst = body.get('bp_systolic', '')
        hr      = body.get('heart_rate', '')
        age     = body.get('age', '')
        killip  = body.get('killip', '')

        # --- 2. 从 Neo4j 查询知识图谱匹配疾病 ---
        symptoms_input = []
        if '胸' in chief or '痛' in chief:
            symptoms_input.extend(['胸痛', '胸闷'])
        if '大汗' in chief or '出汗' in chief:
            symptoms_input.append('出汗')
        if '压榨' in chief:
            symptoms_input.append('压榨感')
        if '放射' in chief:
            symptoms_input.append('放射痛')
        if '恶心' in chief or '呕吐' in chief:
            symptoms_input.append('恶心呕吐')
        if '呼吸困难' in chief or '气促' in chief or '喘' in chief:
            symptoms_input.append('呼吸困难')
        if '端坐呼吸' in chief:
            symptoms_input.append('端坐呼吸')
        if '心悸' in chief or '心慌' in chief:
            symptoms_input.append('心悸')
        if '晕厥' in chief:
            symptoms_input.append('晕厥')
        if '水肿' in chief or '浮肿' in chief:
            symptoms_input.append('水肿')

        # 体征提取（来自查体、生命体征、Killip分级）
        signs_input = []
        if hr:
            try:
                hr_val = int(hr)
                if hr_val > 100: signs_input.append('心动过速')
                elif hr_val < 60: signs_input.append('心动过缓')
            except Exception:
                pass
        if bp_syst:
            try:
                bp_val = int(bp_syst)
                if bp_val < 90: signs_input.append('低血压')
                elif bp_val >= 140: signs_input.append('血压升高')
            except Exception:
                pass
        if killip:
            if killip in ('II', 'III', 'IV'):
                signs_input.extend(['心脏杂音', '心音低钝'])
            if killip in ('III', 'IV'):
                signs_input.extend(['肺部湿啰音', '颈静脉怒张'])
            if killip == 'IV':
                signs_input.extend(['面色苍白', '四肢厥冷'])
        if '水肿' in chief or '浮肿' in chief:
            signs_input.append('下肢凹陷性水肿')
        if '啰音' in chief:
            signs_input.append('肺部湿啰音')

        exam_keywords = []
        if 'ST' in ecg.upper() or '抬高' in ecg:
            exam_keywords.extend(['ST段抬高', '心电图异常'])
        elif ecg:
            exam_keywords.append('心电图异常')

        lab_keywords = []
        if '升高' in troponin or '阳性' in troponin:
            lab_keywords.extend(['肌钙蛋白升高', '心肌标志物升高'])
        if '升高' in ckmb:
            lab_keywords.append('CK-MB升高')

        candidates = []
        d = get_driver()
        with d.session() as sess:
            # 按症状维度查询
            if symptoms_input:
                rows = sess.run("""
                    MATCH (d:Disease)-[:has_symptom]->(n:KGNode)
                    WHERE n.name IN $symptoms
                    RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
                """, symptoms=symptoms_input)
                for r in rows:
                    candidates.append({
                        'disease_code': r['code'], 'disease_name': r['name'],
                        'matched_symptoms': list(r['matched'])
                    })

            # 按体征维度查询
            if signs_input:
                rows = sess.run("""
                    MATCH (d:Disease)-[:has_sign]->(n:KGNode)
                    WHERE n.name IN $signs
                    RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
                """, signs=signs_input)
                by_code = {c['disease_code']: c for c in candidates}
                for r in rows:
                    code = r['code']
                    if code in by_code:
                        by_code[code].setdefault('matched_signs', []).extend(list(r['matched']))
                        by_code[code]['matched_signs'] = list(set(by_code[code]['matched_signs']))
                    else:
                        candidates.append({
                            'disease_code': code, 'disease_name': r['name'],
                            'matched_signs': list(r['matched'])
                        })

            # 按检查维度查询（Schema V2.x: has_exam_plan -> includes_exam_item）
            if exam_keywords:
                rows = sess.run("""
                    MATCH (d:Disease)-[:has_exam_plan]->()-[:includes_exam_item]->(n:KGNode)
                    WHERE n.name IN $exams
                    RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
                """, exams=exam_keywords)
                by_code = {c['disease_code']: c for c in candidates}
                for r in rows:
                    code = r['code']
                    if code in by_code:
                        by_code[code]['matched_exams'] = list(r['matched'])
                    else:
                        candidates.append({
                            'disease_code': code, 'disease_name': r['name'],
                            'matched_exams': list(r['matched'])
                        })

            # 按检验维度查询（Schema V2.x: has_exam_plan -> includes_lab_item）
            if lab_keywords:
                rows = sess.run("""
                    MATCH (d:Disease)-[:has_exam_plan]->()-[:includes_lab_item]->(n:KGNode)
                    WHERE n.name IN $labs
                    RETURN DISTINCT d.code AS code, d.name AS name, collect(DISTINCT n.name) AS matched
                """, labs=lab_keywords)
                by_code = {c['disease_code']: c for c in candidates}
                for r in rows:
                    code = r['code']
                    if code in by_code:
                        by_code[code]['matched_labs'] = list(r['matched'])
                    else:
                        candidates.append({
                            'disease_code': code, 'disease_name': r['name'],
                            'matched_labs': list(r['matched'])
                        })

        # 查询指南信息
        guidelines_map = {}
        try:
            g_data = query_guidelines()
            for g in g_data.get('guidelines', []):
                for dis in g.get('diseases', []):
                    guidelines_map.setdefault(dis['code'], []).append(g['name'])
        except Exception:
            pass

        # 计算置信度与排序（四维度：症状+体征+检查+检验）
        for c in candidates:
            c.setdefault('matched_symptoms', [])
            c.setdefault('matched_signs', [])
            c.setdefault('matched_exams', [])
            c.setdefault('matched_labs', [])
            total = len(c['matched_symptoms']) + len(c['matched_signs']) + len(c['matched_exams']) + len(c['matched_labs'])
            dim_count = sum(1 for k in ['matched_symptoms', 'matched_signs', 'matched_exams', 'matched_labs'] if c[k])
            base = min(0.55 + total * 0.08, 0.98)
            c['confidence'] = round(min(base + dim_count * 0.05, 0.99), 2)
            c['score'] = total

        candidates.sort(key=lambda x: x['confidence'], reverse=True)

        # 强信号提升：当有ST抬高+肌钙蛋白阳性时，确保AMI在候选列表且置信度最高
        has_ami_strong_signal = (
            any(k in chief for k in ['胸', '痛', '压榨', '濒死']) and
            ('升高' in troponin or '阳性' in troponin) and
            ('ST' in ecg.upper() or '抬高' in ecg)
        )
        ami_in_candidates = next((c for c in candidates if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
        if has_ami_strong_signal:
            matched_dims = {}
            if any(k in chief for k in ['胸', '痛']):
                matched_dims['Symptom'] = ['胸痛']
            if '出汗' in chief or '大汗' in chief:
                matched_dims.setdefault('Symptom', []).append('出汗')
            if '恶心' in chief or '呕吐' in chief:
                matched_dims.setdefault('Symptom', []).append('恶心呕吐')
            if 'ST' in ecg.upper() or '抬高' in ecg:
                matched_dims['Exam'] = ['ST段抬高']
            if '升高' in troponin or '阳性' in troponin:
                matched_dims['LabTest'] = ['肌钙蛋白升高']
            if '升高' in ckmb:
                matched_dims.setdefault('LabTest', []).append('CK-MB升高')

            score = sum(len(v) for v in matched_dims.values())
            dim_types = len(matched_dims)
            conf = round(min(0.75 + score * 0.05 + dim_types * 0.03, 0.98), 2)

            ami_entry = {
                'disease_code': 'DIS-CARD-CAD-AMI',
                'disease_name': '急性心肌梗死',
                'matched_symptoms': matched_dims.get('Symptom', []),
                'matched_exams': matched_dims.get('Exam', []),
                'matched_labs': matched_dims.get('LabTest', []),
                'confidence': conf,
                'score': score,
            }
            if ami_in_candidates:
                # 更新已有AMI条目的置信度
                ami_in_candidates['confidence'] = max(ami_in_candidates['confidence'], conf)
                ami_in_candidates['score'] = max(ami_in_candidates['score'], score)
                ami_in_candidates['matched_symptoms'] = list(set(ami_in_candidates.get('matched_symptoms', []) + matched_dims.get('Symptom', [])))
                ami_in_candidates['matched_exams'] = list(set(ami_in_candidates.get('matched_exams', []) + matched_dims.get('Exam', [])))
                ami_in_candidates['matched_labs'] = list(set(ami_in_candidates.get('matched_labs', []) + matched_dims.get('LabTest', [])))
            else:
                candidates.insert(0, ami_entry)
            candidates.sort(key=lambda x: x['confidence'], reverse=True)

        # 若图谱无结果且无强信号，以知识包为兜底
        elif not candidates:
            has_strong_signal = (any(k in chief for k in ['胸', '痛', '压榨', '濒死']) or
                                '升高' in troponin or '阳性' in troponin)
            if has_strong_signal:
                matched_dims = {}
                if any(k in chief for k in ['胸', '痛']):
                    matched_dims['Symptom'] = ['胸痛']
                if '出汗' in chief or '大汗' in chief:
                    matched_dims.setdefault('Symptom', []).append('出汗')
                if 'ST' in ecg.upper() or '抬高' in ecg:
                    matched_dims['Exam'] = ['ST段抬高']
                if '升高' in troponin or '阳性' in troponin:
                    matched_dims['LabTest'] = ['肌钙蛋白升高']
                if '升高' in ckmb:
                    matched_dims.setdefault('LabTest', []).append('CK-MB升高')

                score = sum(len(v) for v in matched_dims.values())
                dim_types = len(matched_dims)
                conf = round(min(0.60 + score * 0.07 + dim_types * 0.04, 0.97), 2)

                candidates.append({
                    'disease_code': 'DIS-CARD-CAD-AMI',
                    'disease_name': '急性心肌梗死',
                    'matched_symptoms': matched_dims.get('Symptom', []),
                    'matched_exams': matched_dims.get('Exam', []),
                    'matched_labs': matched_dims.get('LabTest', []),
                    'confidence': conf,
                    'score': score,
                })

        # --- 3. 加载知识包 ---
        kp_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets', 'ami_knowledge_pack.json')
        knowledge_pack = {}
        try:
            with open(kp_path, 'r', encoding='utf-8') as f:
                knowledge_pack = json.load(f)
        except Exception:
            pass

        # --- 4. 分型判断 ---
        def determine_subtype(disease_code):
            if disease_code != 'DIS-CARD-CAD-AMI':
                return None
            st_elevated = ('ST' in ecg.upper() and ('抬高' in ecg or 'elevat' in ecg.lower()))
            new_lbbb = 'LBBB' in ecg.upper() or '束支传导阻滞' in ecg
            troponin_pos = ('升高' in troponin or '阳性' in troponin)
            if (st_elevated or new_lbbb) and troponin_pos:
                return 'STEMI'
            if troponin_pos and not st_elevated:
                return 'NSTEMI'
            if troponin_pos:
                return 'NSTEMI'
            return None

        # --- 5. 评分计算 ---
        def _calc_grace():
            score = 0
            try:
                a = float(age) if age else 0
            except (ValueError, TypeError):
                a = 0
            if a < 30: score += 0
            elif a < 40: score += 18
            elif a < 50: score += 36
            elif a < 60: score += 55
            elif a < 70: score += 73
            elif a < 80: score += 91
            else: score += 100

            try: h = float(hr) if hr else 75
            except (ValueError, TypeError): h = 75
            if h < 50: score += 0
            elif h < 70: score += 7
            elif h < 90: score += 13
            elif h < 110: score += 23
            elif h < 150: score += 33
            elif h < 200: score += 41
            else: score += 46

            try: s = float(bp_syst) if bp_syst else 120
            except (ValueError, TypeError): s = 120
            if s < 80: score += 58
            elif s < 100: score += 47
            elif s < 120: score += 37
            elif s < 140: score += 26
            elif s < 160: score += 16
            elif s < 200: score += 7
            else: score += 0

            k_str = str(killip).strip().upper() if killip else ''
            killip_scores = {'I': 0, 'II': 20, 'III': 39, 'IV': 59}
            score += killip_scores.get(k_str, 0)

            troponin_pos = ('升高' in troponin or '阳性' in troponin)
            score += 14 if troponin_pos else 0

            st_shift = ('ST' in ecg.upper() and ('抬高' in ecg or '压低' in ecg))
            score += 28 if st_shift else 0

            # 风险等级
            if score <= 108:
                level, mortality = '低危', '<3%'
            elif score <= 140:
                level, mortality = '中危', '3-8%'
            else:
                level, mortality = '高危', '>8%'

            return {'score': score, 'level': level, 'mortality': mortality}

        def _calc_timi():
            score = 0
            try: a = float(age) if age else 0
            except (ValueError, TypeError): a = 0
            score += 1 if a >= 65 else 0
            st_shift = ('ST' in ecg.upper() and ('抬高' in ecg or '压低' in ecg))
            score += 1 if st_shift else 0
            troponin_pos = ('升高' in troponin or '阳性' in troponin)
            score += 1 if troponin_pos else 0

            if score <= 2:
                level, events = '低危', '4.7%'
            elif score <= 4:
                level, events = '中危', '8.3-13.2%'
            else:
                level, events = '高危', '19.9-40.9%'

            return {'score': score, 'level': level, 'events_14d': events}

        def _calc_killip():
            k_str = str(killip).strip().upper() if killip else ''
            killip_data = knowledge_pack.get('risk_scales', {}).get('Killip', {}).get('levels', [])
            for kl in killip_data:
                if kl.get('grade') == k_str:
                    return {'grade': kl['grade'], 'criteria': kl['criteria'], 'mortality': kl['mortality']}
            return {'grade': k_str or '未评估', 'criteria': '', 'mortality': ''}

        def _match_treatment(disease_code, subtype):
            if disease_code != 'DIS-CARD-CAD-AMI' or not subtype:
                return {
                    'plan': 'incomplete_evidence',
                    'name': '证据不足，暂无法推荐方案',
                    'priority': '待评估',
                    'conditions_met': False,
                    'contraindications_check': [],
                    'orders': []
                }
            plans = knowledge_pack.get('treatment_plans', {})
            if subtype == 'STEMI':
                priority_order = ['STEMI_emergency_pci', 'STEMI_thrombolysis']
            else:
                priority_order = ['NSTEMI_invasive', 'NSTEMI_conservative']

            for plan_key in priority_order:
                plan = plans.get(plan_key, {})
                if not plan:
                    continue
                contra_found = []
                contra_list = plan.get('contraindications', [])
                for c in contra_list:
                    if c in chief:
                        contra_found.append(c)
                conditions_met = len(contra_found) == 0

                if subtype == 'NSTEMI':
                    try:
                        grace_score = _calc_grace()['score']
                        if plan_key == 'NSTEMI_invasive' and grace_score <= 140:
                            continue
                        if plan_key == 'NSTEMI_conservative' and grace_score > 140:
                            continue
                    except Exception:
                        pass

                orders = []
                if 'pre_orders' in plan:
                    orders.extend(plan['pre_orders'])
                if 'orders' in plan:
                    orders.extend(plan['orders'])
                if 'adjunct' in plan:
                    orders.extend(plan['adjunct'])

                return {
                    'plan': plan_key,
                    'name': plan.get('name', plan_key),
                    'priority': plan.get('priority', ''),
                    'conditions_met': conditions_met,
                    'contraindications_check': contra_found,
                    'orders': orders
                }

            return {
                'plan': 'incomplete_evidence',
                'name': '证据不足，暂无法推荐方案',
                'priority': '待评估',
                'conditions_met': False,
                'contraindications_check': [],
                'orders': []
            }

        # --- 6. 加载阶段→方案映射 ---
        pathway_stages = knowledge_pack.get('pathway_stages', {})
        stage_plan_map = knowledge_pack.get('stage_plan_map', {})

        # --- 7. 构建最终结果 ---
        output_candidates = []
        for c in candidates:
            code = c['disease_code']
            subtype = determine_subtype(code)
            matched_dims = {}
            if c.get('matched_symptoms'):
                matched_dims['Symptom'] = c['matched_symptoms']
            if c.get('matched_signs'):
                matched_dims['Sign'] = c['matched_signs']
            if c.get('matched_exams'):
                matched_dims['Exam'] = c['matched_exams']
            if c.get('matched_labs'):
                matched_dims['LabTest'] = c['matched_labs']

            risk_scores = {}
            if code == 'DIS-CARD-CAD-AMI':
                risk_scores['GRACE'] = _calc_grace()
                risk_scores['TIMI'] = _calc_timi()
                risk_scores['Killip'] = _calc_killip()

            treatment = _match_treatment(code, subtype)
            differential = knowledge_pack.get('differential_diagnosis', [])

            # 确定当前阶段 + 该阶段可选方案
            current_stage = None
            available_plans = []
            if code == 'DIS-CARD-CAD-AMI' and subtype:
                if subtype == 'STEMI':
                    stage_key = 'STAGE-CARD-CAD-AMI-REPERFUSION-DECISION'
                else:
                    stage_key = 'STAGE-CARD-CAD-AMI-TREATMENT-EXECUTION'
                current_stage = pathway_stages.get(stage_key, {})
                stage_map = stage_plan_map.get(stage_key, {})
                for p in stage_map.get('plans', []):
                    p_copy = dict(p)
                    p_copy['available'] = True
                    blocking = stage_map.get('blocking_check', {}).get(p.get('plan_code', ''), [])
                    if blocking:
                        p_copy['blocking_conditions'] = blocking
                    available_plans.append(p_copy)
            elif code == 'DIS-CARD-CAD-AMI':
                current_stage = pathway_stages.get('STAGE-CARD-CAD-AMI-SCREENING', {})
            recommended_exams = []
            if code == 'DIS-CARD-CAD-AMI':
                recommended_exams = ['D-二聚体', '心超', 'CTA']

            recommended_orders = []
            if code == 'DIS-CARD-CAD-AMI':
                os_data = knowledge_pack.get('order_sets', {})
                recommended_orders = os_data.get('emergency_initial', {}).get('orders', [])
                if subtype:
                    stage_key = 'stemi_immediate' if subtype == 'STEMI' else 'inpatient_daily'
                    recommended_orders.extend(os_data.get(stage_key, {}).get('orders', []))

            output_candidates.append({
                'disease_code': code,
                'disease_name': c['disease_name'],
                'confidence': c['confidence'],
                'matched_dimensions': matched_dims,
                'score': c['score'],
                'subtype': subtype,
                'guidelines': guidelines_map.get(code, []),
                'risk_scores': risk_scores,
                'treatment_recommendation': treatment,
                'differential': differential,
                'recommended_exams': recommended_exams,
                'recommended_orders': recommended_orders,
            })

        order_sets = knowledge_pack.get('order_sets', {})
        knowledge_basis = ''
        for oc in output_candidates:
            if oc.get('guidelines'):
                knowledge_basis = oc['guidelines'][0]
                break
        if not knowledge_basis:
            knowledge_basis = knowledge_pack.get('disease_name', '知识图谱')

        # --- 构建 auto 模式的完整结果（向后兼容） ---
        auto_result = {
            'step': 'auto',
            'candidates': output_candidates,
            'order_sets': order_sets,
            'knowledge_basis': knowledge_basis
        }

        # --- 阶段驱动推理：根据 step 参数返回不同结构 ---
        if step == 'auto':
            return auto_result

        try:
            # ============================================================
            #  构建增强版鉴别诊断详情（所有非auto步骤共用）
            # ============================================================
            differential_details = []
            for diff in knowledge_pack.get('differential_diagnosis', []):
                diff_name = diff.get('name', '')
                # 计算 blocking_impact：检查该疾病是否在 pathway_stages 或 stage_plan_map 的阻断规则中
                blocking_parts = set()
                for _sk, _si in pathway_stages.items():
                    for _rk, _blocked in _si.get('blocking_rules', {}).items():
                        if diff_name in _blocked:
                            blocking_parts.add(f"未排除前阻断{_si.get('name', _sk)}")
                for _sk, _si in stage_plan_map.items():
                    for _pk, _blocked in _si.get('blocking_check', {}).items():
                        if diff_name in _blocked:
                            blocking_parts.add(f"未排除前阻断{_si.get('stage_name', _sk)}")
                differential_details.append({
                    'name': diff_name,
                    'key_features': diff.get('key_features', []),
                    'key_exams': diff.get('key_exams', []),
                    'exclude_signs': diff.get('exclude_signs', []),
                    'urgency': diff.get('urgency', ''),
                    'blocking_impact': '；'.join(sorted(blocking_parts)) if blocking_parts else ''
                })

            # ============================================================
            #  step 1: screening — 高危筛查
            # ============================================================
            if step in ('screening', '1'):
                # ACS 筛查
                acs_symptoms = [s for s in symptoms_input
                                if s in ('胸痛', '胸闷', '压榨感', '放射痛', '出汗')]
                acs_matched = len(acs_symptoms) > 0

                # 心力衰竭筛查
                hf_symptoms = [s for s in symptoms_input
                               if s in ('呼吸困难', '端坐呼吸', '水肿')]
                hf_signs = [s for s in signs_input
                            if s in ('肺部湿啰音', '颈静脉怒张', '下肢凹陷性水肿')]
                hf_killip = killip and killip in ('II', 'III', 'IV')
                hf_matched_items = hf_symptoms + hf_signs
                if hf_killip:
                    hf_matched_items.append(f'Killip {killip}')
                hf_matched = len(hf_matched_items) > 0

                # 心律失常筛查
                arr_symptoms = [s for s in symptoms_input if s in ('心悸', '晕厥')]
                arr_signs = [s for s in signs_input if s in ('心动过速', '心动过缓')]
                arr_matched_items = arr_symptoms + arr_signs
                arr_matched = len(arr_matched_items) > 0

                # 推荐检查：优先从事件规则获取
                screening_exams = ['心电图', '肌钙蛋白I/T', 'CK-MB']
                for rule in knowledge_pack.get('event_rules', []):
                    if rule.get('id') == 'RULE_AMI_SCREEN_001':
                        screening_exams = rule.get('output', {}).get(
                            'recommended_exams', screening_exams)
                        break

                return {
                    'step': 'screening',
                    'high_risk_categories': [
                        {'category': 'ACS', 'matched': acs_matched,
                         'matched_symptoms': acs_symptoms if acs_matched else []},
                        {'category': '心力衰竭', 'matched': hf_matched,
                         'matched_symptoms': hf_matched_items if hf_matched else []},
                        {'category': '心律失常', 'matched': arr_matched,
                         'matched_symptoms': arr_matched_items if arr_matched else []},
                    ],
                    'recommended_exams': screening_exams,
                    'patient_data': {
                        'chief_complaint': chief,
                        'age': int(age) if age else None,
                        'hr': int(hr) if hr else None,
                        'bp': int(bp_syst) if bp_syst else None,
                        'killip': killip or '未评估',
                    }
                }

            # ============================================================
            #  step 2: disease_recommendation — 专病候选推荐
            # ============================================================
            if step in ('disease_recommendation', '2'):
                return {
                    'step': 'disease_recommendation',
                    'candidates': output_candidates,
                    'differential_details': differential_details,
                    'recommended_exams': ['D-二聚体', '心超', 'CTA'],
                }

            # ============================================================
            #  step 3: confirm_pathway — 确认入径
            # ============================================================
            if step in ('confirm_pathway', '3'):
                ami_candidate = next(
                    (c for c in output_candidates
                     if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
                pathway_confirmed = ami_candidate is not None

                # 确定当前阶段
                stage_key = None
                current_stage = None
                if ami_candidate:
                    subtype = ami_candidate.get('subtype')
                    if subtype == 'STEMI':
                        stage_key = 'STAGE-CARD-CAD-AMI-REPERFUSION-DECISION'
                    elif subtype == 'NSTEMI':
                        stage_key = 'STAGE-CARD-CAD-AMI-TREATMENT-EXECUTION'
                    elif ecg or troponin:
                        stage_key = 'STAGE-CARD-CAD-AMI-EVIDENCE'
                    else:
                        stage_key = 'STAGE-CARD-CAD-AMI-SCREENING'
                    current_stage = pathway_stages.get(stage_key, {})

                # 检查已满足/缺失条件
                satisfied_conditions = []
                missing_conditions = []
                if current_stage:
                    for cond in current_stage.get('entry_conditions', []):
                        met = False
                        if '胸痛' in cond or '胸闷' in cond:
                            met = any(s in chief for s in ['胸', '痛'])
                        elif '筛查阳性' in cond:
                            met = ami_candidate is not None
                        elif '心电图' in cond:
                            met = bool(ecg)
                        elif '肌钙蛋白' in cond:
                            met = bool(troponin) and ('升高' in troponin or '阳性' in troponin)
                        elif 'STEMI' in cond and '确诊' in cond:
                            met = (ami_candidate is not None
                                   and ami_candidate.get('subtype') == 'STEMI')
                        elif '发病' in cond:
                            met = True  # 默认假设满足
                        elif '确诊' in cond:
                            met = (ami_candidate is not None
                                   and ami_candidate.get('subtype') is not None)
                        elif '再灌注' in cond or '保守' in cond:
                            met = True
                        elif '病情稳定' in cond or '出院' in cond:
                            met = False
                        if met:
                            satisfied_conditions.append(cond)
                        else:
                            missing_conditions.append(cond)

                # 下一步动作
                next_actions = []
                if missing_conditions:
                    for mc in missing_conditions:
                        if '心电图' in mc:
                            next_actions.append('补充心电图检查')
                        elif '肌钙蛋白' in mc:
                            next_actions.append('补充肌钙蛋白检测')
                        elif '筛查' in mc:
                            next_actions.append('完成高危筛查')
                        elif 'STEMI' in mc or '分型' in mc:
                            next_actions.append('完成STEMI/NSTEMI分型')
                        else:
                            next_actions.append(f'满足条件：{mc}')
                elif current_stage and current_stage.get('next_stage'):
                    ns = pathway_stages.get(current_stage['next_stage'], {})
                    next_actions.append(
                        f"推进至：{ns.get('name', current_stage['next_stage'])}")

                stage_order = 0
                if stage_key and stage_key in pathway_stages:
                    stage_order = list(pathway_stages.keys()).index(stage_key) + 1

                return {
                    'step': 'confirm_pathway',
                    'pathway_confirmed': pathway_confirmed,
                    'pathway_name': 'AMI急诊诊疗路径' if pathway_confirmed else '',
                    'current_stage': {
                        'code': current_stage.get('code', ''),
                        'name': current_stage.get('name', ''),
                        'description': current_stage.get('description', ''),
                        'order': stage_order,
                    } if current_stage else None,
                    'satisfied_conditions': satisfied_conditions,
                    'missing_conditions': missing_conditions,
                    'next_actions': next_actions,
                }

            # ============================================================
            #  step 4+: stage_push — 阶段推进
            # ============================================================
            # 任何非 1/2/3/auto/screening/disease_recommendation/confirm_pathway
            # 的 step 值均视为 stage_push
            current_stage_code = body.get('current_stage_code', '')

            # 未指定 stage_code 时，从输出候选推断
            if not current_stage_code:
                ami_c = next(
                    (c for c in output_candidates
                     if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
                if ami_c:
                    st = ami_c.get('subtype')
                    if st == 'STEMI':
                        current_stage_code = 'STAGE-CARD-CAD-AMI-REPERFUSION-DECISION'
                    elif st == 'NSTEMI':
                        current_stage_code = 'STAGE-CARD-CAD-AMI-TREATMENT-EXECUTION'
                    else:
                        current_stage_code = 'STAGE-CARD-CAD-AMI-EVIDENCE'
                else:
                    current_stage_code = 'STAGE-CARD-CAD-AMI-SCREENING'

            stage_info = pathway_stages.get(current_stage_code, {})
            stage_plan_info = stage_plan_map.get(current_stage_code, {})

            # 检查 entry_conditions
            satisfied_conditions = []
            missing_conditions = []
            for cond in stage_info.get('entry_conditions', []):
                met = False
                if '胸痛' in cond or '胸闷' in cond:
                    met = any(s in chief for s in ['胸', '痛'])
                elif '筛查阳性' in cond:
                    met = len(output_candidates) > 0
                elif '心电图' in cond:
                    met = bool(ecg)
                elif '肌钙蛋白' in cond:
                    met = bool(troponin) and ('升高' in troponin or '阳性' in troponin)
                elif 'STEMI' in cond and '确诊' in cond:
                    ami_c = next((c for c in output_candidates
                                  if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
                    met = ami_c is not None and ami_c.get('subtype') == 'STEMI'
                elif 'NSTEMI' in cond and '确诊' in cond:
                    ami_c = next((c for c in output_candidates
                                  if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
                    met = ami_c is not None and ami_c.get('subtype') == 'NSTEMI'
                elif '发病' in cond:
                    met = True
                elif '确诊' in cond:
                    ami_c = next((c for c in output_candidates
                                  if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
                    met = ami_c is not None and ami_c.get('subtype') is not None
                elif '再灌注' in cond or '保守' in cond:
                    met = True
                elif '治疗执行' in cond:
                    met = True
                elif '病情稳定' in cond or '出院' in cond:
                    met = False
                if met:
                    satisfied_conditions.append(cond)
                else:
                    missing_conditions.append(cond)

            # 推荐动作
            recommended_actions = []
            for plan in stage_plan_info.get('plans', []):
                plan_code = plan.get('plan_code', '')
                plan_name = plan.get('plan_name', '')
                conditions = plan.get('conditions', [])

                blocking = stage_plan_info.get('blocking_check', {}).get(plan_code, [])
                is_blocked = any(bc in chief for bc in blocking) if blocking else False

                if not is_blocked:
                    # 根据 plan_code 判断类型
                    action_type = '治疗'
                    if 'ECG' in plan_code or 'TROPONIN' in plan_code or 'DIFFERENTIAL' in plan_code:
                        action_type = '检查'
                    elif 'GRACE' in plan_code or 'TIMI' in plan_code or 'ASSESSMENT' in plan_code:
                        action_type = '评估'

                    # 证据来源：优先从 treatment_plans 获取
                    evidence = ''
                    for tp in knowledge_pack.get('treatment_plans', {}).values():
                        if plan_name and plan_name in tp.get('name', ''):
                            evidence = tp.get('guideline', '')
                            break
                    if not evidence and 'PCI' in plan_code:
                        evidence = 'ESC STEMI Guidelines 2017 §4.2'
                    elif not evidence and 'THROMBOLYSIS' in plan_code:
                        evidence = 'ESC STEMI Guidelines 2017'

                    recommended_actions.append({
                        'type': action_type,
                        'name': plan_name,
                        'reason': '；'.join(conditions) if conditions else stage_info.get('description', ''),
                        'evidence': evidence,
                    })

            # 若从 stage_plan_info 未获取到推荐动作，根据缺失条件生成默认推荐
            if not recommended_actions and missing_conditions:
                for mc in missing_conditions:
                    action = {'type': '检查', 'name': '', 'reason': f'需满足条件：{mc}',
                              'evidence': ''}
                    if '心电图' in mc:
                        action['name'] = '补充PCI可及性评估'
                        action['reason'] = '决定再灌注策略'
                        action['evidence'] = 'ESC 2017 §4.2'
                    elif '肌钙蛋白' in mc:
                        action['name'] = '补充肌钙蛋白检测'
                        action['evidence'] = 'ESC 2017 §3.1'
                    elif 'PCI' in mc or '再灌注' in mc:
                        action['type'] = '治疗'
                        action['name'] = '评估PCI可及性'
                        action['reason'] = '决定再灌注策略'
                        action['evidence'] = 'ESC 2017 §4.2'
                    else:
                        action['name'] = f'确认：{mc}'
                    recommended_actions.append(action)

            # 阻断动作
            blocked_actions = []
            blocking_rules = stage_info.get('blocking_rules', {})
            for rule_key, blocked_conds in blocking_rules.items():
                action_type = '治疗'
                action_name = rule_key
                if 'PCI' in rule_key.upper():
                    action_name = '直接PCI'
                elif 'THROMBOLYSIS' in rule_key.upper() or '溶栓' in rule_key:
                    action_name = '直接溶栓'

                triggered = [bc for bc in blocked_conds if bc in chief]
                if triggered:
                    blocked_actions.append({
                        'type': action_type,
                        'name': action_name,
                        'reason': '存在禁忌证或阻断条件',
                        'blocking_conditions': triggered,
                    })

            # 风险评分 & 治疗推荐（从 output_candidates 提取）
            risk_scores = {}
            treatment_recommendation = {}
            ami_c = next((c for c in output_candidates
                          if c.get('disease_code') == 'DIS-CARD-CAD-AMI'), None)
            if ami_c:
                risk_scores = ami_c.get('risk_scores', {})
                treatment_recommendation = ami_c.get('treatment_recommendation', {})

            stage_order = 0
            if current_stage_code in pathway_stages:
                stage_order = list(pathway_stages.keys()).index(current_stage_code) + 1

            return {
                'step': 'stage_push',
                'current_stage': {
                    'code': stage_info.get('code', current_stage_code),
                    'name': stage_info.get('name', ''),
                    'description': stage_info.get('description', ''),
                    'order': stage_order,
                } if stage_info else None,
                'satisfied_conditions': satisfied_conditions,
                'missing_conditions': missing_conditions,
                'recommended_actions': recommended_actions,
                'blocked_actions': blocked_actions,
                'risk_scores': risk_scores,
                'treatment_recommendation': treatment_recommendation,
            }

        except Exception as e:
            # 新增逻辑失败时回退到 auto 模式
            auto_result['_step_error'] = str(e)
            auto_result['_step_fallback'] = True
            return auto_result

    def _build_ami_pathway(self):
        """构建 AMI 急诊诊疗路径的节点与连线"""
        nodes = [
            {"id": "n1", "type": "start", "label": "开始", "ability_type": None,
             "x": 80, "y": 300,
             "description": "AMI急诊诊疗流程起点", "config": {}},

            {"id": "n2", "type": "task", "label": "高危大类筛查", "ability_type": "专病识别/筛查",
             "x": 280, "y": 300,
             "description": "急诊主诉保存→识别疑似ACS",
             "config": {"taskType": "入组筛查", "event": "EVT_EMR_SAVE", "rule": "RULE_AMI_SCREEN_001"}},

            {"id": "n3", "type": "task", "label": "首诊评估", "ability_type": "首诊评估",
             "x": 480, "y": 300,
             "description": "生命体征采集、疼痛评估、Killip分级",
             "config": {"taskType": "评估", "event": "EVT_ASSESSMENT_SAVE", "rule": "RULE_AMI_ASSESS_001"}},

            {"id": "n4", "type": "task", "label": "证据补齐", "ability_type": "辅助诊断",
             "x": 680, "y": 300,
             "description": "心电图+肌钙蛋白+CK-MB 证据补齐",
             "config": {"taskType": "检查检验", "event": "EVT_REPORT_BACK", "rule": "RULE_AMI_STEMI_001"}},

            {"id": "n5", "type": "task", "label": "诊断确认", "ability_type": "辅助诊断",
             "x": 880, "y": 300,
             "description": "STEMI/NSTEMI/排除 分支判断",
             "config": {"taskType": "诊断确认", "event": "EVT_DIAGNOSIS_SAVE", "rule": "RULE_AMI_STEMI_001"}},

            {"id": "n6", "type": "task", "label": "鉴别诊断", "ability_type": "辅助诊断",
             "x": 1080, "y": 300,
             "description": "排除主动脉夹层/肺栓塞/心包炎",
             "config": {"taskType": "鉴别诊断", "event": "EVT_DIAGNOSIS_SAVE", "rule": "RULE_AMI_DIFF_001"}},

            {"id": "n7", "type": "task", "label": "分型分层", "ability_type": "分型分层",
             "x": 1280, "y": 300,
             "description": "GRACE/TIMI/Killip 三维分层",
             "config": {"taskType": "分型分层", "event": "EVT_ASSESSMENT_SAVE", "rule": "RULE_AMI_STRATIFY_001"}},

            {"id": "n8", "type": "task", "label": "风险评估", "ability_type": "风险预警",
             "x": 1480, "y": 300,
             "description": "出血风险HAS-BLED+缺血风险联合评估",
             "config": {"taskType": "风险评估", "event": "EVT_ASSESSMENT_SAVE", "rule": "RULE_AMI_RISK_001"}},

            {"id": "n9", "type": "task", "label": "治疗决策", "ability_type": "治疗方案推荐",
             "x": 1680, "y": 300,
             "description": "PCI/溶栓/保守 方案推荐与禁忌证校验",
             "config": {"taskType": "治疗决策", "event": "EVT_ORDER_SAVE_PRE", "rule": "RULE_PCI_CHECK_001"}},

            {"id": "n10", "type": "task", "label": "医嘱校验", "ability_type": "医嘱执行",
             "x": 1880, "y": 300,
             "description": "处方审核、禁忌证拦截、剂量校验",
             "config": {"taskType": "医嘱校验", "event": "EVT_ORDER_SAVE_PRE", "rule": "RULE_PCI_CHECK_001"}},

            {"id": "n11", "type": "task", "label": "医嘱执行", "ability_type": "医嘱执行",
             "x": 2080, "y": 150,
             "description": "药物执行、PCI手术执行、监护",
             "config": {"taskType": "医嘱执行", "event": "EVT_ORDER_EXECUTE", "rule": ""}},

            {"id": "n12", "type": "task", "label": "病历记录", "ability_type": "病历书写",
             "x": 2080, "y": 450,
             "description": "首次病程、入院记录、手术记录自动生成",
             "config": {"taskType": "病历书写", "event": "EVT_EMR_SAVE", "rule": ""}},

            {"id": "n13", "type": "task", "label": "路径追踪", "ability_type": "路径追踪",
             "x": 2280, "y": 150,
             "description": "关键节点时间戳、D2B监控、路径偏离预警",
             "config": {"taskType": "路径追踪", "event": "EVT_PATHWAY_CHECK", "rule": ""}},

            {"id": "n14", "type": "task", "label": "质控反馈", "ability_type": "质控反馈",
             "x": 2280, "y": 450,
             "description": "核心指标达标率、二级预防处方完整性",
             "config": {"taskType": "质控反馈", "event": "EVT_QC_CHECK", "rule": ""}},

            {"id": "n15", "type": "task", "label": "出院准备", "ability_type": "治疗方案推荐",
             "x": 2480, "y": 300,
             "description": "出院评估、带药处方、健康教育",
             "config": {"taskType": "出院准备", "event": "EVT_DISCHARGE_SAVE", "rule": ""}},

            {"id": "n16", "type": "task", "label": "随访管理", "ability_type": "随访管理",
             "x": 2680, "y": 300,
             "description": "1/3/6/12月随访计划与复查提醒",
             "config": {"taskType": "随访管理", "event": "EVT_FOLLOWUP_PLAN", "rule": ""}},

            {"id": "n17", "type": "task", "label": "效果评价", "ability_type": "效果评价",
             "x": 2880, "y": 300,
             "description": "90天MACE事件、再入院率、患者满意度",
             "config": {"taskType": "效果评价", "event": "EVT_OUTCOME_EVAL", "rule": ""}},

            {"id": "n18", "type": "end", "label": "结束", "ability_type": None,
             "x": 3080, "y": 300,
             "description": "诊疗流程结束", "config": {}},
        ]

        connections = [
            {"id": "c1",  "sourceId": "n1",  "targetId": "n2",  "sourcePort": "right", "targetPort": "left", "label": "开始",         "eventType": "无条件"},
            {"id": "c2",  "sourceId": "n2",  "targetId": "n3",  "sourcePort": "right", "targetPort": "left", "label": "疑似ACS",      "eventType": "EVT_EMR_SAVE"},
            {"id": "c3",  "sourceId": "n3",  "targetId": "n4",  "sourcePort": "right", "targetPort": "left", "label": "评估完成",     "eventType": "EVT_ASSESSMENT_SAVE"},
            {"id": "c4",  "sourceId": "n4",  "targetId": "n5",  "sourcePort": "right", "targetPort": "left", "label": "报告回传",     "eventType": "EVT_REPORT_BACK"},
            {"id": "c5",  "sourceId": "n5",  "targetId": "n6",  "sourcePort": "right", "targetPort": "left", "label": "疑似AMI",      "eventType": "EVT_DIAGNOSIS_SAVE"},
            {"id": "c6",  "sourceId": "n6",  "targetId": "n7",  "sourcePort": "right", "targetPort": "left", "label": "鉴别完成",     "eventType": "EVT_DIAGNOSIS_SAVE"},
            {"id": "c7",  "sourceId": "n7",  "targetId": "n8",  "sourcePort": "right", "targetPort": "left", "label": "分型确定",     "eventType": "EVT_ASSESSMENT_SAVE"},
            {"id": "c8",  "sourceId": "n8",  "targetId": "n9",  "sourcePort": "right", "targetPort": "left", "label": "风险明确",     "eventType": "EVT_ASSESSMENT_SAVE"},
            {"id": "c9",  "sourceId": "n9",  "targetId": "n10", "sourcePort": "right", "targetPort": "left", "label": "方案确定",     "eventType": "EVT_ORDER_SAVE_PRE"},
            {"id": "c10", "sourceId": "n10", "targetId": "n11", "sourcePort": "right", "targetPort": "left", "label": "校验通过",     "eventType": "EVT_ORDER_SAVE_PRE"},
            {"id": "c11", "sourceId": "n10", "targetId": "n12", "sourcePort": "right", "targetPort": "left", "label": "同步记录",     "eventType": "EVT_EMR_SAVE"},
            {"id": "c12", "sourceId": "n11", "targetId": "n13", "sourcePort": "right", "targetPort": "left", "label": "执行完成",     "eventType": "EVT_ORDER_EXECUTE"},
            {"id": "c13", "sourceId": "n12", "targetId": "n14", "sourcePort": "right", "targetPort": "left", "label": "记录完成",     "eventType": "EVT_EMR_SAVE"},
            {"id": "c14", "sourceId": "n13", "targetId": "n15", "sourcePort": "right", "targetPort": "left", "label": "病情稳定",     "eventType": "EVT_PATHWAY_CHECK"},
            {"id": "c15", "sourceId": "n14", "targetId": "n15", "sourcePort": "right", "targetPort": "left", "label": "质控通过",     "eventType": "EVT_QC_CHECK"},
            {"id": "c16", "sourceId": "n15", "targetId": "n16", "sourcePort": "right", "targetPort": "left", "label": "出院",         "eventType": "EVT_DISCHARGE_SAVE"},
            {"id": "c17", "sourceId": "n16", "targetId": "n17", "sourcePort": "right", "targetPort": "left", "label": "随访完成",     "eventType": "EVT_FOLLOWUP_PLAN"},
            {"id": "c18", "sourceId": "n17", "targetId": "n18", "sourcePort": "right", "targetPort": "left", "label": "评价完成",     "eventType": "EVT_OUTCOME_EVAL"},
        ]

        ability_types = [
            "专病识别/筛查", "首诊评估", "辅助诊断", "分型分层", "治疗方案推荐",
            "医嘱执行", "病历书写", "路径追踪", "风险预警", "质控反馈", "随访管理", "效果评价"
        ]

        return {
            "disease_code": "DIS-CARD-CAD-AMI",
            "disease_name": "急性心肌梗死",
            "pathway_name": "AMI急诊诊疗路径",
            "nodes": nodes,
            "connections": connections,
            "ability_types": ability_types
        }

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # API 路由
        if path == '/api/kg/version':
            self._json_response(query_full_version())
            return

        if path == '/api/kg/data_version':
            self._json_response(query_data_version())
            return

        if path == '/api/kg/diseases':
            self._json_response(query_disease_list())
            return

        if path == '/api/kg/disease-tree':
            self._json_response(query_disease_tree())
            return

        if path == '/api/kg/diseases/all':
            # 获取所有疾病列表
            diseases_list = query_disease_list()
            # 对每个疾病获取完整数据
            all_diseases = {}
            for d in diseases_list:
                full = query_disease_full(d['code'])
                if full:
                    all_diseases[d['code']] = full
            stats = query_global_stats()
            self._json_response({"diseases": all_diseases, "stats": stats})
            return

        if path == '/api/kg/diseases/summary':
            self._json_response(query_diseases_summary())
            return

        if path == '/api/kg/schema-info':
            self._json_response(query_schema_info())
            return

        if path == '/api/kg/schema-registry':
            # 4001整改：图谱结构注册表（V4.1基准 + 库内实例对照）
            self._json_response(query_schema_registry())
            return

        if path == '/api/kg/dimensions':
            # 维度口径单一事实源：前端启动时动态拉取，Schema升级后前端零改动
            self._json_response(query_dimensions())
            return

        if path == '/api/kg/stats':
            self._json_response(query_global_stats())
            return

        if path == '/api/kg/guidelines':
            self._json_response(query_guidelines())
            return

        # ---- GET /api/kg/pathway/ami ----
        if path == '/api/kg/pathway/ami':
            cache_key = 'kg:pathway:ami'
            cached = cache_get(cache_key)
            if cached is not None:
                self._json_response(cached)
                return
            pathway_data = self._build_ami_pathway()
            cache_set(cache_key, pathway_data)
            self._json_response(pathway_data)
            return

        m = re.match(r'^/api/kg/disease/([A-Za-z0-9\-]+)$', path)
        if m:
            code = m.group(1)
            data = query_disease_full(code)
            if data:
                self._json_response(data)
            else:
                self._json_response({"error": "Disease not found"}, 404)
            return

        # 单个实体查询（别名+关系）
        m2 = re.match(r'^/api/kg/entity/([A-Za-z0-9\-]+)$', path)
        if m2:
            ecode = m2.group(1)
            self._json_response(query_entity_detail(ecode))
            return

        # ---- GET /api/kg/disease/{code}/recommendations ----
        m3 = re.match(r'^/api/kg/disease/([A-Za-z0-9\-]+)/recommendations$', path)
        if m3:
            dc = m3.group(1)
            self._json_response(query_disease_recommendations(dc))
            return

        # ---- GET /api/cdss/recommendation/{rs_code} ----
        m4 = re.match(r'^/api/cdss/recommendation/([A-Za-z0-9\-]+)$', path)
        if m4:
            rs_code = m4.group(1)
            try:
                self._json_response(query_recommendation_detail(rs_code))
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._json_response({"error": str(e)}, 500)
            return

        # ---- GET /api/kg/action-evidence?diseaseCode=xxx&actionCode=yyy ----
        if path == '/api/kg/action-evidence':
            qs = urllib.parse.parse_qs(parsed.query)
            dc = (qs.get('diseaseCode', [''])[0] or '').strip()
            ac = (qs.get('actionCode', [''])[0] or '').strip()
            if not dc or not ac:
                self._json_response({"error": "Missing diseaseCode or actionCode"}, 400)
                return
            self._json_response(query_action_evidence(dc, ac))
            return

        # ---- GET /api/kg/rs-review ----
        if path == '/api/kg/rs-review':
            self._json_response(query_rs_review_summary())
            return

        # ---- GET /api/kg/skeleton-audit ----
        if path == '/api/kg/skeleton-audit':
            self._json_response(query_skeleton_audit())
            return

        # ---- GET /api/kg/cdss/pathway?diseaseCode=xxx ----
        if path == '/api/kg/cdss/pathway':
            qs = urllib.parse.parse_qs(parsed.query)
            disease_code = (qs.get('diseaseCode', [''])[0] or '').strip()
            if not disease_code:
                self._json_response({"error": "diseaseCode required"}, 400)
                return
            self._json_response(query_cdss_pathway(disease_code))
            return

        # ---- GET /api/kg/cdss/diseases ----
        if path == '/api/kg/cdss/diseases':
            try:
                self._json_response(query_cdss_diseases())
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._json_response({"error": str(e)}, 500)
            return

        # ---- GET /api/kg/cdss/coverage ----
        if path == '/api/kg/cdss/coverage':
            try:
                self._json_response(query_cdss_coverage())
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._json_response({"error": str(e)}, 500)
            return

        # ---- GET /api/kg/entities ----
        if path == '/api/kg/entities':
            qs = urllib.parse.parse_qs(parsed.query)
            q = (qs.get('q', [''])[0] or '').strip()
            etype = (qs.get('type', [''])[0] or '').strip()
            category = (qs.get('category', [''])[0] or '').strip()
            limit = int(qs.get('limit', ['50'])[0] or '50')
            offset = int(qs.get('offset', ['0'])[0] or '0')
            try:
                self._json_response(query_entities_search(q, etype, limit, offset, category))
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # ---- GET /api/kg/subgraph ----
        if path == '/api/kg/subgraph':
            qs = urllib.parse.parse_qs(parsed.query)
            code = (qs.get('code', [''])[0] or '').strip()
            hop = int(qs.get('hop', ['1'])[0] or '1')
            limit = int(qs.get('limit', ['50'])[0] or '50')
            if not code:
                self._json_response({"error": "code required"}, 400)
                return
            try:
                self._json_response(query_subgraph(code, hop, limit))
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # ---- GET /api/kg/type-stats ----
        if path == '/api/kg/type-stats':
            try:
                self._json_response(query_entity_types_stats())
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return

        # 未匹配的 /api/* 路径：干净 JSON 404（修复：原先落进静态兜底会先发200头再发404，
        # 两个HTTP响应粘连成非法报文，浏览器/Node均报 Invalid header token）
        if path.startswith('/api/'):
            self._json_response({"error": "Not found", "path": path}, 404)
            return

        # ---------- 静态资源访问黑名单（4001整改 2026-09-28）----------
        # 目的：站点只对外提供"页面与页面资源"。
        # 后端源码(server.py)、日志(*.log)、部署脚本(*.sh)、备份(*.bak)、
        # 进程文件(*.pid)、依赖清单(package.json)、隐藏文件(.gitignore) 一律 404，
        # 避免内网任意访问者直接拉走源码与运行日志。
        _BLOCK_EXT = ('.py', '.pyc', '.pyo', '.sh', '.log', '.bak', '.pid',
                      '.ini', '.conf', '.cfg', '.env', '.sql', '.tar', '.gz', '.zip')
        _BLOCK_NAME = ('package.json', 'package-lock.json', 'VERSION', 'README.md',
                       'requirements.txt', '.gitignore', 'generate-doc.js')
        # 仅后台本机读写、不对外提供的目录（后端落盘快照等）
        _BLOCK_DIR = ('/schema_docs/',)
        _last = path.rstrip('/').split('/')[-1]
        _full = path if path.endswith('/') else path + '/'
        if (_last.startswith('.')
                or _last.lower().endswith(_BLOCK_EXT)
                or _last in _BLOCK_NAME
                or any(d in _full for d in _BLOCK_DIR)):
            self.send_error(404, 'File not found')
            return

        # 静态文件（所有文件禁止缓存，确保每次刷新拿到最新版本）
        # 修复：先判断文件存在再发响应头，避免不存在时 send_error 追加第二个响应
        filepath = self.translate_path(path)
        if os.path.isdir(filepath):
            filepath = os.path.join(filepath, 'index.html')
        if not os.path.isfile(filepath):
            self.send_error(404, 'File not found')
            return
        self.send_response(200)
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        if True:
            # 自动检测 MIME 类型
            ext = os.path.splitext(filepath)[1].lower()
            mime_map = {'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon'}
            mime = mime_map.get(ext, 'application/octet-stream')
            with open(filepath, 'rb') as f:
                content = f.read()
            self.send_header('Content-Type', mime + ('; charset=utf-8' if mime.startswith('text') or mime.endswith('javascript') or mime.endswith('json') else ''))
            # gzip 压缩：大于 1KB 的文本/JS/CSS/JSON 文件
            accept_enc = self.headers.get('Accept-Encoding', '')
            compressible = mime.startswith('text') or mime.endswith('javascript') or mime.endswith('json') or mime.endswith('svg')
            if 'gzip' in accept_enc and compressible and len(content) > 1024:
                content = gzip.compress(content, compresslevel=6)
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)

    def _json_response(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        # gzip 压缩 JSON 响应
        accept_enc = self.headers.get('Accept-Encoding', '')
        if 'gzip' in accept_enc and len(body) > 1024:
            body = gzip.compress(body, compresslevel=6)
            self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(body)))
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
    http.server.HTTPServer.allow_reuse_address = True
    server = ThreadedHTTPServer(('0.0.0.0', port), KGHandler)
    print(f"知识图谱动态服务启动: http://0.0.0.0:{port}")
    print(f"Neo4j: {NEO4J_URI}")
    print(f"API: /api/kg/diseases | /api/kg/stats | /api/kg/disease/<code> | /api/kg/guidelines")
    print(f"NEW: POST /api/kg/diagnose | GET /api/kg/pathway/ami")
    server.serve_forever()


if __name__ == "__main__":
    main()
