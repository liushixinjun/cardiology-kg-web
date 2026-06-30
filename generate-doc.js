const { Document, Packer, Paragraph, TextRun, Header, Footer, AlignmentType, HeadingLevel, PageNumber, PageBreak } = require('docx');
const fs = require('fs');

// 创建文档
const doc = new Document({
  styles: {
    default: {
      document: {
        run: {
          font: { ascii: "Arial", hAnsi: "Arial", eastAsia: "Microsoft YaHei" },
          size: 24
        }
      }
    }
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "心血管专科知识图谱Web系统 - 操作手册", size: 18, color: "666666" })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "第 ", size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18 }),
            new TextRun({ text: " 页", size: 18 })
          ]
        })]
      })
    },
    children: [
      // 封面
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 4800 },
        children: [new TextRun({ text: "心血管专科知识图谱Web系统", size: 48, bold: true })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 480 },
        children: [new TextRun({ text: "功能操作说明", size: 36, bold: true })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 960 },
        children: [new TextRun({ text: "基于Neo4j的交互式知识图谱可视化平台", size: 24, color: "666666" })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400 },
        children: [new TextRun({ text: "版本：v1.4.1", size: 20 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 240 },
        children: [new TextRun({ text: "日期：2026年6月29日", size: 20 })]
      }),

      // 目录
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("目录")]
      }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("1. 系统概述")] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("2. 系统登录与访问")] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("3. 功能模块操作指南")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.1 数据总览")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.2 图谱探索")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.3 网络探索")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.4 数据覆盖分析")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.5 临床诊断模拟")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.6 图谱数据字典")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.7 Schema标准")] }),
      new Paragraph({ spacing: { after: 120 }, children: [new TextRun("   3.8 医学术语知识库")] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("   3.9 系统配置")] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("4. 使用技巧")] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("5. 常见问题解答")] }),
      new Paragraph({ spacing: { after: 240 }, children: [new TextRun("6. 联系支持")] }),

      // 正文开始
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("1. 系统概述")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("心血管专科知识图谱Web系统是一个基于Neo4j图数据库的交互式知识可视化平台，专注于心血管内科专科知识的结构化展示与分析。系统整合了84种心血管疾病、17个知识维度、28,966个知识节点和12,470条关系边，为医疗专业人员提供全面、直观的知识图谱浏览和分析工具。")]
      }),
      
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("核心功能")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("知识图谱可视化：交互式图形展示疾病、症状、检查、治疗等实体关系")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("多维度数据浏览：按临床逻辑分组的17个知识维度")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("智能诊断辅助：基于知识图谱的临床诊断模拟")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("数据质量分析：疾病知识完整度评估与缺口识别")]
      }),

      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("技术架构")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("前端：HTML5 + CSS3 + JavaScript + ECharts 5.x")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("后端：Python Flask + Neo4j Cypher查询")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("数据库：Neo4j图数据库（实时连接）")]
      }),

      // 系统登录
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("2. 系统登录与访问")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("访问地址")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("本地部署地址：http://192.168.3.27:4001/")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("登录方式")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("系统采用无登录设计，用户可直接访问各功能模块。首次使用时建议从\"数据总览\"开始，了解系统整体架构和数据概况。")]
      }),

      // 功能模块操作指南
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("3. 功能模块操作指南")]
      }),

      // 3.1 数据总览
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.1 数据总览")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("数据总览模块提供系统整体数据概况，包括疾病分类、知识维度成熟度、数据质量分析等核心指标。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 数据总览（默认首页）")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("核心功能")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("专科专病知识路径：展示从专科到疾病大类、专病、知识维度的层级结构")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("专病知识资产构成：以柱状图展示各维度实体数量分布")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("疾病大类与专病完整率：按疾病大类展示各专病的知识完整度")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("17维度知识成熟度：展示各维度在所有疾病中的覆盖情况")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("重点质量缺口：识别数据缺失较严重的维度")]
      }),

      // 3.2 图谱探索
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.2 图谱探索")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("图谱探索模块是系统的核心功能，支持按疾病查看详细的17维度知识、关系网络和实体详情。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 图谱探索")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("界面布局")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("左侧：疾病树状列表，支持搜索和分组折叠")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("中间：主内容区，包含三个视图切换（疾病视角、关系视角、实体视角）")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("右侧：详情面板，展示选中实体的详细信息")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("疾病视角操作")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("在左侧疾病树中选择目标疾病")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("系统按临床逻辑分组展示：临床表现、诊断检查、治疗方案、预后随访、病因机制、风险诊断")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("点击实体标签可查看详细信息")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("关系视角操作")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("切换到\"关系视角\"标签页")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("图谱展示疾病与各维度实体的关联关系")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("支持鼠标拖拽、缩放、点击节点展开关联")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("实体视角操作")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("切换到\"实体视角\"标签页")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("支持按疾病、维度筛选实体")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("点击实体可查看关联关系和疾病信息")]
      }),

      // 3.3 网络探索
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.3 网络探索")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("网络探索模块提供交互式知识图谱，支持维度筛选、路径查找、全屏浏览等高级功能。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 网络探索")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("核心功能")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("疾病选择：从下拉菜单选择目标疾病")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("维度筛选：点击维度标签控制图谱显示内容")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("路径模式：点击\"路径\"按钮，依次选择两个节点查找最短路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("全屏模式：点击全屏按钮进入沉浸式浏览")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("节点交互：点击节点展开关联，双击节点查看详情")]
      }),

      // 3.4 数据覆盖分析
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.4 数据覆盖分析")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("数据覆盖分析模块提供84种专病×17维度的矩阵视图，帮助识别知识缺口。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 数据覆盖分析")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("核心功能")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("热力图展示：颜色深浅表示数据完整度")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("疾病筛选：按疾病大类或具体疾病过滤")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("维度统计：各维度的平均完整度分析")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("缺口识别：快速定位缺失数据的疾病-维度组合")]
      }),

      // 3.5 临床诊断模拟
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.5 临床诊断模拟")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("临床诊断模拟模块支持输入病例信息，基于知识图谱匹配候选疾病。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 临床诊断模拟")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("操作步骤")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("在输入框中输入症状、体征、检查结果等信息")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("系统自动匹配相关疾病")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("查看匹配度评分和匹配依据")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("点击疾病可跳转到图谱探索查看详情")]
      }),

      // 3.6 图谱数据字典
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.6 图谱数据字典")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("图谱数据字典模块提供系统数据结构的详细说明。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 图谱数据字典")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("包含内容")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("实体类型定义：疾病、症状、检查、药物等实体类型说明")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("关系类型说明：实体间关系类型及语义定义")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("疾病分类体系：心血管疾病分类结构")]
      }),

      // 3.7 Schema标准
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.7 Schema标准")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("Schema标准模块提供专科专病图谱的建模标准、字段约束和质量规则。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → Schema标准")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("包含内容")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("数据模型定义：图谱节点和关系的数据结构")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("字段约束规则：必填字段、数据格式、取值范围")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("质量校验规则：数据完整性、一致性检查标准")]
      }),

      // 3.8 医学术语知识库
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.8 医学术语知识库")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("医学术语知识库模块按维度浏览所有医学术语，支持搜索、分类筛选和关联关系查看。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 医学术语知识库")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("核心功能")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("维度分类：按17个知识维度浏览术语")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("搜索功能：支持术语名称、编码搜索")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("关联查看：查看术语在不同疾病中的应用")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("统计信息：各维度术语数量统计")]
      }),

      // 3.9 系统配置
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("3.9 系统配置")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("系统配置模块用于维护Neo4j图谱服务地址和连接参数。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("访问路径")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("首页 → 系统配置")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: [new TextRun("配置项")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("Neo4j服务地址：图数据库连接地址")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("认证信息：用户名和密码")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("连接测试：验证数据库连接状态")]
      }),

      // 使用技巧
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("4. 使用技巧")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("快捷操作")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("图谱缩放：鼠标滚轮或触控板手势")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("节点拖拽：按住鼠标左键拖动节点")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("搜索定位：在搜索框输入关键词快速定位")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("筛选组合：多维度组合筛选精确定位")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("最佳实践")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("从数据总览开始，了解系统整体情况")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("使用图谱探索深入查看特定疾病知识")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("利用网络探索发现知识关联关系")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("通过数据覆盖分析识别知识缺口")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("结合临床诊断模拟验证知识应用")]
      }),

      // 常见问题
      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("5. 常见问题解答")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Q1: 图谱加载缓慢怎么办？")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("A: 图谱数据量较大时可能加载较慢，建议：1) 检查网络连接；2) 减少同时显示的维度数量；3) 使用搜索功能快速定位目标节点。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Q2: 如何查看实体的详细信息？")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("A: 在图谱中点击目标实体节点，右侧详情面板会显示该实体的详细信息，包括名称、编码、所属维度、关联疾病等。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Q3: 路径查找功能如何使用？")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("A: 在网络探索模块中：1) 点击\"路径\"按钮进入路径模式；2) 点击第一个节点作为起点；3) 点击第二个节点作为终点；4) 系统自动计算并高亮显示最短路径。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Q4: 数据覆盖分析中的颜色含义？")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("A: 热力图中颜色越深表示该疾病在该维度的数据越完整，颜色越浅表示数据缺失越严重。白色表示无数据。")]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun("Q5: 临床诊断模拟的准确性如何？")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("A: 临床诊断模拟基于现有知识图谱数据进行匹配，结果仅供参考，不能替代专业医生的诊断。建议结合临床经验和其他检查结果综合判断。")]
      }),

      // 联系支持
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("6. 联系支持")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("如遇到系统使用问题或有功能建议，请通过以下方式联系支持团队：")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("系统管理员：联系负责系统部署和维护的技术人员")]
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun("技术支持：提交问题报告或功能建议")]
      }),
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun("文档反馈：帮助完善系统使用文档")]
      }),

      new Paragraph({ children: [new PageBreak()] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 2400 },
        children: [new TextRun({ text: "感谢使用心血管专科知识图谱Web系统", size: 28, bold: true })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 480 },
        children: [new TextRun({ text: "本手册将持续更新，以反映系统最新功能和改进", size: 20, color: "666666" })]
      }),
    ]
  }]
});

// 生成文档
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("心血管专科知识图谱Web系统-功能操作说明.docx", buffer);
  console.log("文档已生成：心血管专科知识图谱Web系统-功能操作说明.docx");
}).catch(error => {
  console.error("生成文档时出错：", error);
});
