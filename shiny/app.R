# ═══════════════════════════════════════════════════════════════════════════════
# SPC Análisis — Shiny App
# ═══════════════════════════════════════════════════════════════════════════════
# Instalar dependencias:
#   install.packages(c("shiny", "shinydashboard", "ggplot2", "DT", "readxl"))
#
# Publicar en shinyapps.io:
#   library(rsconnect)
#   rsconnect::deployApp("ruta/a/esta/carpeta")
# ═══════════════════════════════════════════════════════════════════════════════

library(shiny)
library(shinydashboard)
library(ggplot2)
library(DT)
library(readxl)

`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0 && !is.na(a[1])) a else b

# ── Constantes SPC ─────────────────────────────────────────────────────────────

.XR <- data.frame(
  n  = 2:10,
  A2 = c(1.880, 1.023, 0.729, 0.577, 0.483, 0.419, 0.373, 0.337, 0.308),
  D3 = c(0.000, 0.000, 0.000, 0.000, 0.000, 0.076, 0.136, 0.184, 0.223),
  D4 = c(3.267, 2.574, 2.282, 2.114, 2.004, 1.924, 1.864, 1.816, 1.777)
)
.XS <- data.frame(
  n  = 2:10,
  A3 = c(2.659, 1.954, 1.628, 1.427, 1.287, 1.182, 1.099, 1.032, 0.975),
  B3 = c(0.000, 0.000, 0.000, 0.000, 0.030, 0.118, 0.185, 0.239, 0.284),
  B4 = c(3.267, 2.568, 2.266, 2.089, 1.970, 1.882, 1.815, 1.761, 1.716)
)
.D2 <- c(NA, 1.128, 1.693, 2.059, 2.326, 2.534, 2.704, 2.847, 2.970, 3.078)

# ── Funciones SPC ──────────────────────────────────────────────────────────────

nelson_violations <- function(pts, cl, ucl, lcl) {
  n <- length(pts)
  viol <- integer(0)

  # Regla 1: más allá de ±3σ
  viol <- union(viol, which(pts > ucl | pts < lcl))

  # Regla 2: 9 consecutivos mismo lado de LC
  if (n >= 9) {
    for (i in 9:n) {
      w <- pts[(i - 8):i]
      if (all(w > cl) || all(w < cl)) viol <- union(viol, i)
    }
  }

  # Regla 3: 6 consecutivos en tendencia monótona
  if (n >= 6) {
    for (i in 6:n) {
      d <- diff(pts[(i - 5):i])
      if (all(d > 0) || all(d < 0)) viol <- union(viol, i)
    }
  }

  # Regla 4: 14 alternando arriba/abajo
  if (n >= 14) {
    for (i in 14:n) {
      d <- sign(diff(pts[(i - 13):i]))
      if (length(d) > 1 && all(d[-length(d)] != d[-1])) viol <- union(viol, i)
    }
  }

  sort(viol)
}

calc_capability <- function(vals, usl, lsl) {
  v <- vals[!is.na(vals)]
  if (length(v) < 2 || is.na(usl) || is.na(lsl) || usl <= lsl) {
    return(NULL)
  }
  xbar <- mean(v)
  sigma <- sd(v)
  if (sigma == 0) {
    return(NULL)
  }
  cp <- (usl - lsl) / (6 * sigma)
  cpu <- (usl - xbar) / (3 * sigma)
  cpl <- (xbar - lsl) / (3 * sigma)
  cpk <- min(cpu, cpl)
  ppm <- (pnorm(usl, xbar, sigma, lower.tail = FALSE) +
    pnorm(lsl, xbar, sigma, lower.tail = TRUE)) * 1e6
  list(
    n = length(v), xbar = round(xbar, 4), sigma = round(sigma, 4),
    cp = round(cp, 3), cpu = round(cpu, 3), cpl = round(cpl, 3),
    cpk = round(cpk, 3), ppm = round(ppm, 1),
    status = if (cpk >= 1.33) "capaz" else if (cpk >= 1.0) "marginal" else "no_capaz",
    method = "total (s muestral)"
  )
}

calc_capability_subgroups <- function(vals, usl, lsl, n_sg) {
  v <- vals[!is.na(vals)]
  k <- floor(length(v) / n_sg)
  if (k < 2) {
    return(NULL)
  }
  mat <- matrix(v[1:(k * n_sg)], nrow = n_sg)
  xbars <- colMeans(mat)
  ranges <- apply(mat, 2, function(col) diff(range(col)))
  xbar_g <- mean(xbars)
  sigma_w <- mean(ranges) / .D2[n_sg]
  if (sigma_w == 0) {
    return(NULL)
  }
  cp <- (usl - lsl) / (6 * sigma_w)
  cpu <- (usl - xbar_g) / (3 * sigma_w)
  cpl <- (xbar_g - lsl) / (3 * sigma_w)
  cpk <- min(cpu, cpl)
  ppm <- (pnorm(usl, xbar_g, sigma_w, lower.tail = FALSE) +
    pnorm(lsl, xbar_g, sigma_w, lower.tail = TRUE)) * 1e6
  list(
    n = k * n_sg, xbar = round(xbar_g, 4), sigma = round(sigma_w, 4),
    sigma_total = round(sd(v[1:(k * n_sg)]), 4),
    cp = round(cp, 3), cpu = round(cpu, 3), cpl = round(cpl, 3),
    cpk = round(cpk, 3), ppm = round(ppm, 1),
    status = if (cpk >= 1.33) "capaz" else if (cpk >= 1.0) "marginal" else "no_capaz",
    method = paste0("dentro de subgrupos (R̅/d₂, n=", n_sg, ")")
  )
}

calc_control_chart <- function(vals, type = "imr", n_sg = 5) {
  v <- vals[!is.na(vals)]
  if (length(v) < 4) {
    return(NULL)
  }

  if (type == "imr") {
    mr <- abs(diff(v))
    xbar <- mean(v)
    mr_bar <- mean(mr)
    x_ucl <- xbar + 2.66 * mr_bar
    x_lcl <- xbar - 2.66 * mr_bar
    mr_ucl <- 3.267 * mr_bar
    return(list(
      type = "I-MR",
      chart1 = list(
        title = "Carta I (Individuales)", pts = v, cl = xbar, ucl = x_ucl, lcl = x_lcl,
        viol = nelson_violations(v, xbar, x_ucl, x_lcl)
      ),
      chart2 = list(
        title = "Carta MR (Rango Móvil)", pts = mr, cl = mr_bar, ucl = mr_ucl, lcl = 0,
        viol = nelson_violations(mr, mr_bar, mr_ucl, 0)
      )
    ))
  }

  n <- as.integer(n_sg)
  if (n < 2 || n > 10) {
    return(NULL)
  }
  k <- floor(length(v) / n)
  if (k < 2) {
    return(NULL)
  }
  mat <- matrix(v[1:(k * n)], nrow = n)
  xbars <- colMeans(mat)
  x_cl <- mean(xbars)

  if (type == "xbar_r") {
    ct <- .XR[.XR$n == n, ]
    disp <- apply(mat, 2, function(col) diff(range(col)))
    d_bar <- mean(disp)
    x_ucl <- x_cl + ct$A2 * d_bar
    x_lcl <- x_cl - ct$A2 * d_bar
    d_ucl <- ct$D4 * d_bar
    d_lcl <- ct$D3 * d_bar
    return(list(
      type = "X̄-R",
      chart1 = list(
        title = "Carta X̄ (Medias)", pts = xbars, cl = x_cl, ucl = x_ucl, lcl = x_lcl,
        viol = nelson_violations(xbars, x_cl, x_ucl, x_lcl)
      ),
      chart2 = list(
        title = "Carta R (Rangos)", pts = disp, cl = d_bar, ucl = d_ucl, lcl = d_lcl,
        viol = nelson_violations(disp, d_bar, d_ucl, d_lcl)
      )
    ))
  }

  # xbar_s
  ct <- .XS[.XS$n == n, ]
  disp <- apply(mat, 2, sd)
  d_bar <- mean(disp)
  x_ucl <- x_cl + ct$A3 * d_bar
  x_lcl <- x_cl - ct$A3 * d_bar
  d_ucl <- ct$B4 * d_bar
  d_lcl <- ct$B3 * d_bar
  list(
    type = "X̄-S",
    chart1 = list(
      title = "Carta X̄ (Medias)", pts = xbars, cl = x_cl, ucl = x_ucl, lcl = x_lcl,
      viol = nelson_violations(xbars, x_cl, x_ucl, x_lcl)
    ),
    chart2 = list(
      title = "Carta S (Desviación Est.)", pts = disp, cl = d_bar, ucl = d_ucl, lcl = d_lcl,
      viol = nelson_violations(disp, d_bar, d_ucl, d_lcl)
    )
  )
}

anderson_darling_test <- function(vals) {
  v <- vals[!is.na(vals)]
  n <- length(v)
  if (n < 7) {
    return(list(
      available = FALSE, test = "Anderson-Darling (Normalidad)",
      reason = paste0("Se necesitan ≥7 observaciones (n=", n, ")")
    ))
  }
  mu <- mean(v)
  s <- sd(v)
  if (s == 0) {
    return(list(
      available = FALSE, test = "Anderson-Darling (Normalidad)",
      reason = "Desviación estándar = 0"
    ))
  }
  sv <- sort(v)
  S <- 0
  for (i in seq_len(n)) {
    p1 <- max(pnorm(sv[i], mu, s), 1e-15)
    p2 <- max(pnorm(sv[n + 1 - i], mu, s, lower.tail = FALSE), 1e-15)
    S <- S + (2 * i - 1) * (log(p1) + log(p2))
  }
  A2 <- (-n - S / n) * (1 + 0.75 / n + 2.25 / n^2)
  p <- if (A2 < 0.200) {
    1 - exp(-13.436 + 101.14 * A2 - 223.73 * A2^2)
  } else if (A2 < 0.340) {
    1 - exp(-8.318 + 42.796 * A2 - 59.938 * A2^2)
  } else if (A2 < 0.600) {
    exp(0.9177 - 4.279 * A2 - 1.38 * A2^2)
  } else if (A2 < 13) {
    exp(1.2937 - 5.709 * A2 + 0.0186 * A2^2)
  } else {
    0
  }
  p <- min(1, max(0, p))
  list(
    available = TRUE,
    test = "Anderson-Darling (Normalidad)",
    statistic = round(A2, 4), p_value = round(p, 4), n = n,
    pass = p > 0.05,
    result = if (p > 0.05) "No se rechaza H₀ (normal)" else "Se rechaza H₀ (no normal)",
    interpretation = if (p > 0.05) {
      paste0("p = ", round(p, 4), " > 0.05 → Los datos son consistentes con normalidad.")
    } else {
      paste0("p = ", round(p, 4), " ≤ 0.05 → Los datos NO siguen distribución normal.")
    }
  )
}

levenes_test <- function(groups) {
  k <- length(groups)
  if (k < 2) {
    return(list(
      available = FALSE, test = "Levene Brown-Forsythe (Homogeneidad de varianzas)",
      reason = "Se necesitan ≥2 grupos"
    ))
  }
  if (any(sapply(groups, length) < 2)) {
    return(list(
      available = FALSE, test = "Levene Brown-Forsythe",
      reason = "Cada grupo necesita ≥2 observaciones"
    ))
  }
  N <- sum(sapply(groups, length))
  meds <- sapply(groups, median)
  Z <- lapply(seq_along(groups), function(i) abs(groups[[i]] - meds[i]))
  Zi_bar <- sapply(Z, mean)
  Z_bar <- mean(unlist(Z))
  num <- (N - k) * sum(sapply(seq_along(groups), function(i) length(groups[[i]]) * (Zi_bar[i] - Z_bar)^2))
  den <- (k - 1) * sum(sapply(seq_along(Z), function(i) sum((Z[[i]] - Zi_bar[i])^2)))
  if (den == 0) {
    return(list(
      available = FALSE, test = "Levene Brown-Forsythe",
      reason = "Sin varianza suficiente para el cálculo"
    ))
  }
  W <- num / den
  p <- pf(W, df1 = k - 1, df2 = N - k, lower.tail = FALSE)
  list(
    available = TRUE,
    test = "Levene Brown-Forsythe (Homogeneidad de varianzas)",
    statistic = round(W, 4), p_value = round(p, 4), df1 = k - 1, df2 = N - k,
    pass = p > 0.05,
    result = if (p > 0.05) "No se rechaza H₀ (varianzas homogéneas)" else "Se rechaza H₀",
    interpretation = if (p > 0.05) {
      paste0("p = ", round(p, 4), " > 0.05 → Las varianzas son homogéneas en los ", k, " grupos.")
    } else {
      paste0("p = ", round(p, 4), " ≤ 0.05 → Las varianzas NO son homogéneas entre los ", k, " grupos.")
    }
  )
}

kruskal_test <- function(groups) {
  k <- length(groups)
  if (k < 2) {
    return(list(
      available = FALSE, test = "Kruskal-Wallis (Homogeneidad de medianas)",
      reason = "Se necesitan ≥2 grupos"
    ))
  }
  vals <- unlist(groups)
  grp <- factor(rep(seq_along(groups), sapply(groups, length)))
  kt <- kruskal.test(vals ~ grp)
  p <- kt$p.value
  list(
    available = TRUE,
    test = "Kruskal-Wallis (Homogeneidad de medianas)",
    statistic = round(kt$statistic, 4), p_value = round(p, 4), df = as.integer(kt$parameter),
    pass = p > 0.05,
    result = if (p > 0.05) "No se rechaza H₀" else "Se rechaza H₀",
    interpretation = if (p > 0.05) {
      paste0("p = ", round(p, 4), " > 0.05 → No hay diferencias significativas entre los ", k, " grupos.")
    } else {
      paste0("p = ", round(p, 4), " ≤ 0.05 → Existen diferencias significativas entre los ", k, " grupos.")
    }
  )
}

make_control_plot <- function(chart) {
  n <- length(chart$pts)
  df <- data.frame(idx = seq_len(n), val = chart$pts, viol = seq_len(n) %in% chart$viol)
  lx <- max(df$idx) + 0.3
  p <- ggplot(df, aes(x = idx, y = val)) +
    geom_line(color = "#64748b", linewidth = 0.6) +
    geom_point(aes(color = viol), size = 2.8) +
    scale_color_manual(values = c("FALSE" = "#2563eb", "TRUE" = "#dc2626"), guide = "none") +
    geom_hline(yintercept = chart$cl, color = "#16a34a", linewidth = 0.9) +
    geom_hline(yintercept = chart$ucl, color = "#dc2626", linewidth = 0.8, linetype = "dashed") +
    geom_hline(yintercept = chart$lcl, color = "#dc2626", linewidth = 0.8, linetype = "dashed") +
    annotate("text", x = lx, y = chart$ucl, label = paste0("UCL=", round(chart$ucl, 3)), hjust = 0, size = 3.2, color = "#dc2626") +
    annotate("text", x = lx, y = chart$cl, label = paste0("CL=", round(chart$cl, 3)), hjust = 0, size = 3.2, color = "#16a34a") +
    annotate("text", x = lx, y = chart$lcl, label = paste0("LCL=", round(chart$lcl, 3)), hjust = 0, size = 3.2, color = "#dc2626") +
    scale_x_continuous(expand = expansion(add = c(0.5, 4))) +
    labs(title = chart$title, x = "Muestra", y = "Valor") +
    theme_minimal(base_size = 13) +
    theme(
      plot.title = element_text(face = "bold"),
      plot.background = element_rect(fill = "white", color = NA),
      panel.background = element_rect(fill = "white", color = NA)
    )
  if (any(df$viol)) {
    p <- p + geom_point(
      data = df[df$viol, ], aes(x = idx, y = val),
      color = "#dc2626", size = 5, shape = 21, fill = NA, stroke = 1.5
    )
  }
  p
}

make_capability_plot <- function(vals, usl, lsl, nominal = NULL) {
  v <- vals[!is.na(vals)]
  xbar <- mean(v)
  sigma <- sd(v)
  x_lo <- min(min(v), lsl, xbar - 4 * sigma)
  x_hi <- max(max(v), usl, xbar + 4 * sigma)
  nbins <- min(30, max(5, round(sqrt(length(v)))))
  df_n <- data.frame(x = seq(x_lo, x_hi, length.out = 400))
  df_n$dens <- dnorm(df_n$x, xbar, sigma)

  p <- ggplot(data.frame(v = v), aes(x = v)) +
    geom_histogram(aes(y = after_stat(density)),
      bins = nbins,
      fill = "#bfdbfe", color = "#3b82f6", linewidth = 0.3
    ) +
    geom_line(data = df_n, aes(x = x, y = dens), color = "#1d4ed8", linewidth = 1.3) +
    geom_vline(xintercept = usl, color = "#dc2626", linewidth = 1.2, linetype = "dashed") +
    geom_vline(xintercept = lsl, color = "#dc2626", linewidth = 1.2, linetype = "dashed") +
    geom_vline(xintercept = xbar, color = "#16a34a", linewidth = 1.0) +
    annotate("text", x = usl, y = Inf, label = " USL", vjust = 2, hjust = 0, color = "#dc2626", size = 3.5) +
    annotate("text", x = lsl, y = Inf, label = "LSL ", vjust = 2, hjust = 1, color = "#dc2626", size = 3.5) +
    annotate("text", x = xbar, y = Inf, label = " X̄", vjust = 2, hjust = 0, color = "#16a34a", size = 3.5) +
    labs(title = "Histograma de Capacidad con Curva Normal", x = "Valor", y = "Densidad") +
    theme_minimal(base_size = 13) +
    theme(
      plot.title = element_text(face = "bold"),
      plot.background = element_rect(fill = "white", color = NA),
      panel.background = element_rect(fill = "white", color = NA)
    )
  if (!is.null(nominal) && !is.na(nominal)) {
    p <- p +
      geom_vline(xintercept = nominal, color = "#9333ea", linewidth = 0.8, linetype = "dotted") +
      annotate("text", x = nominal, y = Inf, label = " Nom", vjust = 2, hjust = 0, color = "#9333ea", size = 3.5)
  }
  p
}

# ── Datos de ejemplo ───────────────────────────────────────────────────────────

set.seed(42)
.DEMO_PROC <- data.frame(
  id = 1:2,
  nombre = c("Diámetro de eje", "Espesor de pared"),
  unidad = c("mm", "mm"),
  lsl = c(49.50, 2.80), nominal = c(50.00, 3.00), usl = c(50.50, 3.20),
  desc = c("Eje principal torneado CNC", "Pared de tubo extruido"),
  stringsAsFactors = FALSE
)
.DEMO_MEAS <- data.frame(
  id = 1:80,
  process_id = c(rep(1L, 50), rep(2L, 30)),
  valor = c(round(rnorm(50, 50.01, 0.12), 3), round(rnorm(30, 3.01, 0.055), 3)),
  subgrupo = c(rep(1:10, each = 5), rep(1:6, each = 5)),
  timestamp = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
  stringsAsFactors = FALSE
)

# ── UI ─────────────────────────────────────────────────────────────────────────

ui <- dashboardPage(
  skin = "blue",
  dashboardHeader(title = "SPC Análisis"),
  dashboardSidebar(
    sidebarMenu(
      id = "tabs",
      menuItem("Dashboard", tabName = "t_dash", icon = icon("tachometer-alt")),
      menuItem("Procesos", tabName = "t_proc", icon = icon("cogs")),
      menuItem("Datos", tabName = "t_datos", icon = icon("table")),
      menuItem("Cartas de Control", tabName = "t_carta", icon = icon("chart-bar")),
      menuItem("Capacidad", tabName = "t_cap", icon = icon("bullseye")),
      menuItem("Pruebas Estadísticas", tabName = "t_test", icon = icon("flask"))
    )
  ),
  dashboardBody(
    tags$head(tags$style(HTML("
      .bdg-capaz    { background:#dcfce7; color:#16a34a; padding:3px 12px; border-radius:20px; font-weight:700; display:inline-block; }
      .bdg-marginal { background:#fef3c7; color:#d97706; padding:3px 12px; border-radius:20px; font-weight:700; display:inline-block; }
      .bdg-no_capaz { background:#fee2e2; color:#dc2626; padding:3px 12px; border-radius:20px; font-weight:700; display:inline-block; }
      .mcard { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; margin-bottom:10px; }
      .mlbl  { font-size:11px; font-weight:700; text-transform:uppercase; color:#94a3b8; margin-bottom:2px; }
      .mval  { font-size:26px; font-weight:800; color:#0f172a; }
      .mval.green  { color:#16a34a; } .mval.orange { color:#d97706; } .mval.red { color:#dc2626; }
      .tpass { background:#dcfce7; border:1px solid #bbf7d0; border-radius:8px; padding:14px; margin-bottom:12px; }
      .tfail { background:#fee2e2; border:1px solid #fecaca; border-radius:8px; padding:14px; margin-bottom:12px; }
      .tna   { background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-bottom:12px; }
    "))),
    tabItems(
      # ── Dashboard ───────────────────────────────────────────────────────────
      tabItem(
        "t_dash",
        h2("Dashboard"),
        fluidRow(
          valueBoxOutput("vb_total", 4),
          valueBoxOutput("vb_capaz", 4),
          valueBoxOutput("vb_nocapaz", 4)
        ),
        fluidRow(
          box(
            width = 12, title = "Resumen de Procesos",
            DTOutput("dt_dash"), br(),
            actionButton("btn_demo", "Cargar Datos de Ejemplo",
              icon = icon("magic"), class = "btn-info btn-sm"
            )
          )
        )
      ),

      # ── Procesos ────────────────────────────────────────────────────────────
      tabItem(
        "t_proc",
        h2("Gestión de Procesos"),
        fluidRow(
          box(
            width = 4, title = "Nuevo Proceso",
            textInput("p_nom", "Nombre *", placeholder = "Ej: Diámetro de eje"),
            textInput("p_uni", "Unidad", placeholder = "Ej: mm"),
            numericInput("p_lsl", "LSL (límite inferior)", value = NA),
            numericInput("p_nomi", "Nominal (objetivo)", value = NA),
            numericInput("p_usl", "USL (límite superior)", value = NA),
            textAreaInput("p_desc", "Descripción", rows = 2),
            actionButton("btn_addp", "Agregar Proceso",
              class = "btn-primary btn-block", icon = icon("plus")
            )
          ),
          box(
            width = 8, title = "Procesos",
            DTOutput("dt_proc"), br(),
            actionButton("btn_delp", "Eliminar Seleccionado",
              class = "btn-danger btn-sm", icon = icon("trash")
            )
          )
        )
      ),

      # ── Datos ───────────────────────────────────────────────────────────────
      tabItem(
        "t_datos",
        h2("Ingreso de Datos"),
        fluidRow(column(
          12,
          selectInput("d_proc", "Proceso:", choices = NULL, width = "360px")
        )),
        tabsetPanel(
          tabPanel(
            "Manual", br(),
            fluidRow(
              box(
                width = 4, title = "Agregar Mediciones",
                textAreaInput("d_vals", "Valores (por línea, coma o espacio):",
                  rows = 8, placeholder = "10.23\n10.15\n10.31\n..."
                ),
                numericInput("d_sg", "ID Subgrupo (opcional):", value = NA),
                actionButton("btn_addm", "Agregar",
                  class = "btn-primary btn-block", icon = icon("plus")
                )
              ),
              box(
                width = 8, title = "Mediciones del Proceso",
                DTOutput("dt_meds"), br(),
                actionButton("btn_delm", "Eliminar Seleccionadas",
                  class = "btn-danger btn-sm", icon = icon("trash")
                )
              )
            )
          ),
          tabPanel(
            "Importar CSV / Excel", br(),
            fluidRow(
              box(
                width = 5, title = "Cargar Archivo",
                fileInput("f_file", "Seleccionar archivo:",
                  accept = c(".csv", ".xlsx", ".xls", "text/csv")
                ),
                selectInput("f_vcol", "Columna de valores:", choices = NULL),
                selectInput("f_scol", "Columna de subgrupo (opcional):",
                  choices = c("(ninguna)" = "")
                ),
                actionButton("btn_import", "Importar",
                  class = "btn-primary btn-block", icon = icon("upload")
                )
              ),
              box(width = 7, title = "Vista Previa", DTOutput("dt_prev"))
            )
          )
        )
      ),

      # ── Cartas de Control ───────────────────────────────────────────────────
      tabItem(
        "t_carta",
        h2("Cartas de Control"),
        box(
          width = 12,
          fluidRow(
            column(4, selectInput("cc_proc", "Proceso:", choices = NULL)),
            column(3, selectInput("cc_tipo", "Tipo:",
              choices = c(
                "I-MR (Individuales)" = "imr",
                "X̄-R (Medias y Rangos)" = "xbar_r",
                "X̄-S (Medias y Desv.)" = "xbar_s"
              )
            )),
            column(2, numericInput("cc_n", "Tamaño subgrupo:", value = 5, min = 2, max = 10)),
            column(
              3, br(),
              actionButton("btn_cc", "Generar Carta",
                class = "btn-primary btn-block", icon = icon("chart-bar")
              )
            )
          )
        ),
        box(width = 12, uiOutput("ui_cc"))
      ),

      # ── Capacidad ───────────────────────────────────────────────────────────
      tabItem(
        "t_cap",
        h2("Análisis de Capacidad"),
        fluidRow(
          box(
            width = 4,
            selectInput("cap_proc", "Proceso:", choices = NULL),
            numericInput("cap_n",
              "Agrupar en subgrupos de n (0 = datos individuales):",
              value = 0, min = 0, max = 10
            ),
            actionButton("btn_cap", "Calcular",
              class = "btn-primary btn-block", icon = icon("calculator")
            ),
            br(), uiOutput("ui_cap_met")
          ),
          box(width = 8, plotOutput("plt_cap", height = "420px"))
        )
      ),

      # ── Pruebas Estadísticas ────────────────────────────────────────────────
      tabItem(
        "t_test",
        h2("Pruebas Estadísticas"),
        fluidRow(
          box(
            width = 4,
            selectInput("ts_proc", "Proceso:", choices = NULL),
            numericInput("ts_n",
              "Tamaño de subgrupo para agrupar (0 = usar columna subgrupo):",
              value = 0, min = 0, max = 10
            ),
            actionButton("btn_tst", "Ejecutar Pruebas",
              class = "btn-primary btn-block", icon = icon("flask")
            )
          ),
          box(width = 8, title = "Resultados", uiOutput("ui_tests"))
        )
      )
    )
  )
)

# ── Server ─────────────────────────────────────────────────────────────────────

server <- function(input, output, session) {
  rv <- reactiveValues(
    procs = data.frame(
      id = integer(), nombre = character(), unidad = character(),
      lsl = numeric(), nominal = numeric(), usl = numeric(),
      desc = character(), stringsAsFactors = FALSE
    ),
    meas = data.frame(
      id = integer(), process_id = integer(), valor = numeric(),
      subgrupo = integer(), timestamp = character(),
      stringsAsFactors = FALSE
    ),
    pcnt = 0L, mcnt = 0L
  )

  # Sincronizar selects de proceso
  observe({
    ch <- if (nrow(rv$procs) == 0) {
      c("(sin procesos)" = "")
    } else {
      setNames(as.character(rv$procs$id), rv$procs$nombre)
    }
    for (id in c("d_proc", "cc_proc", "cap_proc", "ts_proc")) {
      updateSelectInput(session, id, choices = ch)
    }
  })

  # ── Demo ──────────────────────────────────────────────────────────────────
  observeEvent(input$btn_demo, {
    rv$procs <- .DEMO_PROC
    rv$meas <- .DEMO_MEAS
    rv$pcnt <- max(.DEMO_PROC$id)
    rv$mcnt <- max(.DEMO_MEAS$id)
    showNotification("Datos de ejemplo cargados — explora las pestañas", type = "message")
  })

  # ── Crear proceso ─────────────────────────────────────────────────────────
  observeEvent(input$btn_addp, {
    nom <- trimws(input$p_nom)
    if (nchar(nom) == 0) {
      showNotification("El nombre es requerido", type = "warning")
      return()
    }
    rv$pcnt <- rv$pcnt + 1L
    rv$procs <- rbind(rv$procs, data.frame(
      id = rv$pcnt, nombre = nom, unidad = trimws(input$p_uni),
      lsl = input$p_lsl, nominal = input$p_nomi, usl = input$p_usl,
      desc = trimws(input$p_desc), stringsAsFactors = FALSE
    ))
    showNotification(paste0("Proceso '", nom, "' creado"), type = "message")
    updateTextInput(session, "p_nom", value = "")
    updateTextInput(session, "p_uni", value = "")
    updateNumericInput(session, "p_lsl", value = NA)
    updateNumericInput(session, "p_nomi", value = NA)
    updateNumericInput(session, "p_usl", value = NA)
  })

  observeEvent(input$btn_delp, {
    sel <- input$dt_proc_rows_selected
    if (is.null(sel)) {
      showNotification("Selecciona un proceso primero", type = "warning")
      return()
    }
    pid <- rv$procs$id[sel]
    rv$procs <- rv$procs[rv$procs$id != pid, ]
    rv$meas <- rv$meas[rv$meas$process_id != pid, ]
  })

  output$dt_proc <- renderDT({
    df <- rv$procs
    if (nrow(df) == 0) {
      return(data.frame(Info = "Sin procesos — agrega uno a la izquierda"))
    }
    datatable(df[, c("nombre", "unidad", "lsl", "nominal", "usl", "desc")],
      colnames = c("Nombre", "Unidad", "LSL", "Nominal", "USL", "Descripción"),
      selection = "single", rownames = FALSE, options = list(pageLength = 10)
    )
  })

  # ── Agregar mediciones ─────────────────────────────────────────────────────
  observeEvent(input$btn_addm, {
    pid_s <- input$d_proc
    if (is.null(pid_s) || nchar(pid_s) == 0) {
      showNotification("Selecciona un proceso", type = "warning")
      return()
    }
    pid <- as.integer(pid_s)
    tokens <- unlist(strsplit(trimws(input$d_vals), "[\\n\\r;,\\s\\t]+"))
    tokens <- tokens[nchar(trimws(tokens)) > 0]
    vals <- suppressWarnings(sapply(tokens, function(t) {
      v <- as.numeric(trimws(t))
      if (is.na(v)) v <- as.numeric(gsub(",", ".", trimws(t)))
      v
    }))
    vals <- unname(vals[!is.na(vals)])
    if (length(vals) == 0) {
      showNotification("No se encontraron valores válidos", type = "warning")
      return()
    }
    sg <- if (is.na(input$d_sg)) NA_integer_ else as.integer(input$d_sg)
    ids <- (rv$mcnt + 1L):(rv$mcnt + length(vals))
    rv$meas <- rbind(rv$meas, data.frame(
      id = ids, process_id = pid, valor = vals,
      subgrupo = rep(sg, length(vals)),
      timestamp = format(Sys.time(), "%Y-%m-%d %H:%M:%S"),
      stringsAsFactors = FALSE
    ))
    rv$mcnt <- rv$mcnt + length(vals)
    updateTextAreaInput(session, "d_vals", value = "")
    showNotification(paste0(length(vals), " medición(es) agregadas"), type = "message")
  })

  output$dt_meds <- renderDT({
    pid_s <- input$d_proc
    req(pid_s, nchar(pid_s) > 0)
    pid <- as.integer(pid_s)
    df <- rv$meas[rv$meas$process_id == pid, c("id", "valor", "subgrupo", "timestamp")]
    datatable(df,
      colnames = c("ID", "Valor", "Subgrupo", "Fecha"),
      selection = "multiple", rownames = FALSE,
      options = list(pageLength = 15, order = list(list(0, "desc")))
    )
  })

  observeEvent(input$btn_delm, {
    sel <- input$dt_meds_rows_selected
    if (is.null(sel)) {
      showNotification("Selecciona mediciones primero", type = "warning")
      return()
    }
    pid <- as.integer(input$d_proc)
    df <- rv$meas[rv$meas$process_id == pid, ]
    ids_del <- df$id[sel]
    rv$meas <- rv$meas[!rv$meas$id %in% ids_del, ]
    showNotification(paste0(length(ids_del), " eliminada(s)"), type = "message")
  })

  # ── Importar archivo ───────────────────────────────────────────────────────
  fdata <- reactive({
    req(input$f_file)
    ext <- tools::file_ext(input$f_file$name)
    tryCatch(
      if (ext %in% c("xlsx", "xls")) {
        read_excel(input$f_file$datapath)
      } else {
        ln <- readLines(input$f_file$datapath, n = 1, warn = FALSE)
        sep <- if (grepl(";", ln)) ";" else ","
        read.csv(input$f_file$datapath, sep = sep, stringsAsFactors = FALSE)
      },
      error = function(e) {
        showNotification(paste("Error al leer:", e$message), type = "error")
        NULL
      }
    )
  })

  observe({
    df <- fdata()
    req(df)
    cols <- names(df)
    auto <- grep("valor|value|medicion|val|meas", cols, ignore.case = TRUE, value = TRUE)[1] %||% cols[1]
    updateSelectInput(session, "f_vcol", choices = cols, selected = auto)
    updateSelectInput(session, "f_scol", choices = c("(ninguna)" = "", cols))
  })

  output$dt_prev <- renderDT({
    df <- fdata()
    req(df)
    datatable(head(df, 50), rownames = FALSE, options = list(pageLength = 8, scrollX = TRUE))
  })

  observeEvent(input$btn_import, {
    df <- fdata()
    pid_s <- input$d_proc
    req(df, pid_s, nchar(pid_s) > 0)
    pid <- as.integer(pid_s)
    vcol <- input$f_vcol
    if (!vcol %in% names(df)) {
      showNotification("Columna de valores inválida", type = "error")
      return()
    }
    raw <- df[[vcol]]
    vals <- suppressWarnings(as.numeric(gsub(",", ".", as.character(raw))))
    ok <- !is.na(vals)
    vals <- vals[ok]
    if (length(vals) == 0) {
      showNotification("Sin valores válidos en la columna seleccionada", type = "error")
      return()
    }
    scol <- input$f_scol
    sgs <- rep(NA_integer_, length(vals))
    if (nchar(scol) > 0 && scol %in% names(df)) {
      sgs <- suppressWarnings(as.integer(df[[scol]][ok]))[seq_along(vals)]
    }
    ids <- (rv$mcnt + 1L):(rv$mcnt + length(vals))
    rv$meas <- rbind(rv$meas, data.frame(
      id = ids, process_id = pid, valor = vals, subgrupo = sgs,
      timestamp = format(Sys.time(), "%Y-%m-%d %H:%M:%S"), stringsAsFactors = FALSE
    ))
    rv$mcnt <- rv$mcnt + length(vals)
    showNotification(paste0(length(vals), " datos importados"), type = "message")
  })

  # ── Dashboard ─────────────────────────────────────────────────────────────
  dash_df <- reactive({
    df <- rv$procs
    if (nrow(df) == 0) {
      return(df)
    }
    df$Mediciones <- sapply(df$id, function(p) sum(rv$meas$process_id == p))
    df$Cpk <- sapply(df$id, function(p) {
      v <- rv$meas$valor[rv$meas$process_id == p]
      pr <- df[df$id == p, ]
      if (length(v) < 2 || is.na(pr$usl) || is.na(pr$lsl)) {
        return(NA_real_)
      }
      cap <- calc_capability(v, pr$usl, pr$lsl)
      if (is.null(cap)) NA_real_ else cap$cpk
    })
    df$Estado <- sapply(df$Cpk, function(k) {
      if (is.na(k)) {
        "—"
      } else if (k >= 1.33) {
        "Capaz"
      } else if (k >= 1.0) {
        "Marginal"
      } else {
        "No Capaz"
      }
    })
    df
  })

  output$vb_total <- renderValueBox(valueBox(nrow(rv$procs), "Procesos", icon = icon("cogs"), color = "blue"))
  output$vb_capaz <- renderValueBox(valueBox(sum(dash_df()$Estado == "Capaz", na.rm = TRUE), "Capaces (Cpk ≥1.33)", icon = icon("check-circle"), color = "green"))
  output$vb_nocapaz <- renderValueBox(valueBox(sum(dash_df()$Estado == "No Capaz", na.rm = TRUE), "No Capaces (Cpk <1.0)", icon = icon("times-circle"), color = "red"))

  output$dt_dash <- renderDT({
    df <- dash_df()
    if (nrow(df) == 0) {
      return(data.frame(Info = "Crea un proceso o carga los datos de ejemplo"))
    }
    datatable(df[, c("nombre", "unidad", "lsl", "nominal", "usl", "Mediciones", "Cpk", "Estado")],
      colnames = c("Proceso", "Unidad", "LSL", "Nominal", "USL", "# Mediciones", "Cpk", "Estado"),
      rownames = FALSE, options = list(pageLength = 10, dom = "tp")
    )
  })

  # ── Cartas de Control ──────────────────────────────────────────────────────
  cc_res <- eventReactive(input$btn_cc, {
    pid_s <- input$cc_proc
    req(pid_s, nchar(pid_s) > 0)
    pid <- as.integer(pid_s)
    vals <- rv$meas$valor[rv$meas$process_id == pid]
    if (length(vals) < 4) {
      return(list(error = "Se necesitan al menos 4 mediciones"))
    }
    res <- calc_control_chart(vals, input$cc_tipo, input$cc_n)
    if (is.null(res)) {
      list(error = "Datos insuficientes para el tipo/tamaño de subgrupo seleccionado")
    } else {
      res
    }
  })

  output$ui_cc <- renderUI({
    res <- cc_res()
    req(res)
    if (!is.null(res$error)) {
      return(div(
        style = "background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px;",
        icon("exclamation-triangle"), " ", res$error
      ))
    }
    v1 <- res$chart1$viol
    v2 <- res$chart2$viol
    msg <- if (length(v1) == 0 && length(v2) == 0) {
      div(
        style = "background:#dcfce7;border:1px solid #bbf7d0;border-radius:8px;padding:12px;",
        icon("check-circle"), " No se detectaron violaciones a las Reglas de Nelson"
      )
    } else {
      tagList(
        if (length(v1) > 0) {
          div(
            style = "background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:6px;",
            icon("exclamation-triangle"), " ", strong(res$chart1$title), ": puntos ", paste(v1, collapse = ", ")
          )
        },
        if (length(v2) > 0) {
          div(
            style = "background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px;",
            icon("exclamation-triangle"), " ", strong(res$chart2$title), ": puntos ", paste(v2, collapse = ", ")
          )
        }
      )
    }
    tagList(
      plotOutput("plt_cc1", height = "300px"), br(),
      plotOutput("plt_cc2", height = "280px"), br(),
      msg
    )
  })

  output$plt_cc1 <- renderPlot({
    r <- cc_res()
    req(r, is.null(r$error))
    make_control_plot(r$chart1)
  })
  output$plt_cc2 <- renderPlot({
    r <- cc_res()
    req(r, is.null(r$error))
    make_control_plot(r$chart2)
  })

  # ── Capacidad ──────────────────────────────────────────────────────────────
  cap_res <- eventReactive(input$btn_cap, {
    pid_s <- input$cap_proc
    req(pid_s, nchar(pid_s) > 0)
    pid <- as.integer(pid_s)
    proc <- rv$procs[rv$procs$id == pid, ]
    if (nrow(proc) == 0) {
      return(list(error = "Proceso no encontrado"))
    }
    vals <- rv$meas$valor[rv$meas$process_id == pid]
    if (length(vals) < 2) {
      return(list(error = "Se necesitan al menos 2 mediciones"))
    }
    if (is.na(proc$usl) || is.na(proc$lsl)) {
      return(list(error = "El proceso requiere LSL y USL definidos"))
    }
    n_sg <- as.integer(input$cap_n)
    cap <- if (n_sg >= 2) {
      calc_capability_subgroups(vals, proc$usl, proc$lsl, n_sg)
    } else {
      calc_capability(vals, proc$usl, proc$lsl)
    }
    if (is.null(cap)) {
      return(list(error = "No se pudo calcular (datos insuficientes o σ=0)"))
    }
    list(cap = cap, vals = vals, proc = proc)
  })

  output$ui_cap_met <- renderUI({
    res <- cap_res()
    req(res)
    if (!is.null(res$error)) {
      return(div(
        style = "background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-top:12px;",
        res$error
      ))
    }
    cap <- res$cap
    sc <- paste0("bdg-", cap$status)
    sl <- c(capaz = "CAPAZ", marginal = "MARGINAL", no_capaz = "NO CAPAZ")[cap$status]
    mc <- function(lbl, val, col = NULL) {
      vc <- paste0("mval", if (!is.null(col)) paste0(" ", col) else "")
      div(class = "mcard", div(class = "mlbl", lbl), div(class = vc, val))
    }
    tagList(
      hr(), div(class = sc, sl), br(),
      fluidRow(
        column(6, mc("Cpk", cap$cpk, if (cap$cpk >= 1.33) "green" else if (cap$cpk >= 1.0) "orange" else "red")),
        column(6, mc("Cp", cap$cp))
      ),
      fluidRow(column(6, mc("Cpu", cap$cpu)), column(6, mc("Cpl", cap$cpl))),
      fluidRow(column(6, mc("X̄", cap$xbar)), column(6, mc("σ", cap$sigma))),
      mc("PPM estimado", format(round(cap$ppm), big.mark = ",")),
      mc("N mediciones", cap$n),
      div(
        class = "mcard",
        div(class = "mlbl", "Método σ"),
        div(style = "font-size:12px;color:#475569;", cap$method)
      )
    )
  })

  output$plt_cap <- renderPlot({
    res <- cap_res()
    req(res, is.null(res$error))
    make_capability_plot(res$vals, res$proc$usl, res$proc$lsl, res$proc$nominal)
  })

  # ── Pruebas Estadísticas ───────────────────────────────────────────────────
  tst_res <- eventReactive(input$btn_tst, {
    pid_s <- input$ts_proc
    req(pid_s, nchar(pid_s) > 0)
    pid <- as.integer(pid_s)
    df <- rv$meas[rv$meas$process_id == pid & !is.na(rv$meas$valor), ]
    if (nrow(df) < 7) {
      return(list(error = "Se necesitan al menos 7 mediciones"))
    }
    vals <- df$valor
    n_sg <- as.integer(input$ts_n)

    groups <- if (n_sg >= 2) {
      k <- floor(length(vals) / n_sg)
      lapply(seq_len(k), function(g) vals[((g - 1) * n_sg + 1):(g * n_sg)])
    } else if (!all(is.na(df$subgrupo))) {
      sg_ids <- unique(df$subgrupo[!is.na(df$subgrupo)])
      gs <- lapply(sg_ids, function(s) df$valor[!is.na(df$subgrupo) & df$subgrupo == s])
      gs[sapply(gs, length) >= 2]
    } else {
      list()
    }

    no_grp <- list(available = FALSE, reason = "Sin subgrupos válidos — asigna IDs de subgrupo o usa el parámetro n")
    list(
      ad = anderson_darling_test(vals),
      levene = if (length(groups) >= 2) {
        levenes_test(groups)
      } else {
        modifyList(no_grp, list(test = "Levene Brown-Forsythe (Homogeneidad de varianzas)"))
      },
      kruskal = if (length(groups) >= 2) {
        kruskal_test(groups)
      } else {
        modifyList(no_grp, list(test = "Kruskal-Wallis (Homogeneidad de medianas)"))
      }
    )
  })

  output$ui_tests <- renderUI({
    res <- tst_res()
    req(res)
    if (!is.null(res$error)) {
      return(div(
        style = "background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:14px;",
        res$error
      ))
    }

    render_test <- function(t) {
      if (!isTRUE(t$available)) {
        return(div(class = "tna", icon("info-circle"), " ", strong(t$test %||% "Prueba"), ": ", t$reason))
      }
      cls <- if (isTRUE(t$pass)) "tpass" else "tfail"
      ic <- if (isTRUE(t$pass)) icon("check-circle") else icon("times-circle")
      div(
        class = cls,
        h4(ic, " ", t$test),
        p(strong("Estadístico: "), t$statistic, " | ", strong("p-valor: "), t$p_value),
        p(strong("Resultado: "), t$result),
        p(t$interpretation)
      )
    }
    tagList(render_test(res$ad), render_test(res$levene), render_test(res$kruskal))
  })
}

shinyApp(ui, server)
