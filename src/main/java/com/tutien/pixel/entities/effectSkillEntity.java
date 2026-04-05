package com.tutien.pixel.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "status")
public class effectSkillEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(unique = true, nullable = false)
    private String code;
    private String name;
    private String description;
    private int thoiGian; //bao lau
    private int satThuong;
    private int lamCham;
    private String classCss;
    private int gayChoang;
}
