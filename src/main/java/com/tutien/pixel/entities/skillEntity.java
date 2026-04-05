package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "skills")
public class skillEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Enumerated(EnumType.STRING)
    private linhCanEnum linhCan;
    private String code;
    private String name;
    private String description;
    private String icon;
    private int mpTieuHao;
    private int hoiChieu;
    private int satThuong;
    private int dienRong;
    private statsEmbed stats;
    private int thoiGianBuff;
    @Enumerated(EnumType.STRING)
    private skillType type;
    @ManyToOne
    @JoinColumn(name = "sfx_id")  // cột foreign key trên bảng user
    private effectSkillEntity sfx;
}
