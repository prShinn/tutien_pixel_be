package com.tutien.pixel.entities;

import jakarta.persistence.*;

import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "monster")
public class monsterEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private int id;
    @Column(unique = true)
    private String code;
    private String name;
    private int level;
    private int hp;
    private int atk;
    private int def;
    private int speed;
    private int moneyDropTo;
    private int moneyDropFrom;
    private int tyLeRoiTien;
    private int tyLeRoiDo;
    private String color;
    @OneToMany(mappedBy = "code", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<vatPhamEntity> drops = new ArrayList<>();
    private String sfx_name;
    @ManyToOne
    @JoinColumn(name = "sfx_id")  // cột foreign key trên bảng user
    private effectSkillEntity sfx;
}
